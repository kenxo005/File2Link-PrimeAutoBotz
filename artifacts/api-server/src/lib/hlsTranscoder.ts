import { spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { streamFileByMessage } from "./gramjsClient.js";
import { logger } from "./logger.js";

const HLS_TMP_ROOT = path.join(os.tmpdir(), "f2l-hls");
fs.mkdirSync(HLS_TMP_ROOT, { recursive: true });

const SESSION_TTL_MS = 10 * 60 * 1000;       // idle eviction (Railway free-tier RAM friendly)
const MAX_CONCURRENT_SESSIONS = 2;            // hard cap on simultaneous ffmpeg jobs
const STARTUP_TIMEOUT_MS = 90_000;
const SEGMENT_WAIT_MS = 60_000;

interface HlsSession {
  id: string;
  dir: string;
  playlistPath: string;
  ffmpeg: ChildProcess | null;
  ready: Promise<void>;
  lastAccess: number;
  done: boolean;
  failed: boolean;
}

const sessions = new Map<string, HlsSession>();

export function getOrCreateSession(
  videoId: string,
  chatId: number,
  messageId: number,
): HlsSession {
  const existing = sessions.get(videoId);
  if (existing && !existing.failed) {
    existing.lastAccess = Date.now();
    return existing;
  }
  if (existing?.failed) {
    sessions.delete(videoId);
    try {
      fs.rmSync(existing.dir, { recursive: true, force: true });
    } catch {}
  }
  // Enforce concurrency cap — evict oldest idle session
  if (sessions.size >= MAX_CONCURRENT_SESSIONS) {
    const oldest = [...sessions.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess)[0];
    if (oldest) {
      const [oid, os] = oldest;
      try { os.ffmpeg?.kill("SIGKILL"); } catch {}
      try { fs.rmSync(os.dir, { recursive: true, force: true }); } catch {}
      sessions.delete(oid);
      logger.info({ oid }, "Evicted HLS session (concurrency cap)");
    }
  }
  const s = createSession(videoId, chatId, messageId);
  sessions.set(videoId, s);
  return s;
}

function createSession(videoId: string, chatId: number, messageId: number): HlsSession {
  const dir = path.join(HLS_TMP_ROOT, videoId);
  fs.mkdirSync(dir, { recursive: true });
  const playlistPath = path.join(dir, "index.m3u8");

  const ff = spawn("ffmpeg", [
    "-y",
    "-loglevel", "warning",
    "-fflags", "+genpts+discardcorrupt",
    "-i", "pipe:0",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-tune", "zerolatency",
    "-crf", "26",
    "-pix_fmt", "yuv420p",
    "-profile:v", "main",
    "-level", "4.0",
    "-c:a", "aac",
    "-b:a", "128k",
    "-ac", "2",
    "-ar", "44100",
    "-sn",
    "-f", "hls",
    "-hls_time", "4",
    "-hls_list_size", "0",
    "-hls_flags", "independent_segments+append_list+temp_file",
    "-hls_segment_filename", path.join(dir, "seg-%05d.ts"),
    playlistPath,
  ]);

  const session: HlsSession = {
    id: videoId,
    dir,
    playlistPath,
    ffmpeg: ff,
    ready: Promise.resolve(),
    lastAccess: Date.now(),
    done: false,
    failed: false,
  };

  ff.stderr.on("data", (d: Buffer) => {
    const msg = d.toString().trim();
    if (msg) logger.debug({ videoId }, `ffmpeg: ${msg.slice(0, 300)}`);
  });
  ff.on("close", (code) => {
    logger.info({ videoId, code }, "ffmpeg HLS process exited");
    session.done = true;
    if (code !== 0 && code !== null) session.failed = true;
  });
  ff.on("error", (err) => {
    logger.error({ err, videoId }, "ffmpeg spawn error");
    session.failed = true;
  });

  // Pipe Telegram bytes into ffmpeg stdin
  streamFileByMessage(chatId, messageId, (chunk) => {
    if (!ff.stdin || ff.stdin.destroyed) return false;
    try {
      ff.stdin.write(chunk);
      return true;
    } catch {
      return false;
    }
  })
    .then(() => {
      try {
        ff.stdin?.end();
      } catch {}
    })
    .catch((err) => {
      logger.error({ err, videoId }, "gramjs->ffmpeg pipe failed");
      session.failed = true;
      try {
        ff.kill("SIGKILL");
      } catch {}
    });

  // Wait for the playlist to contain its first segment
  session.ready = new Promise<void>((resolve, reject) => {
    const startedAt = Date.now();
    const interval = setInterval(() => {
      if (session.failed) {
        clearInterval(interval);
        reject(new Error("HLS transcoder failed to start"));
        return;
      }
      if (fs.existsSync(playlistPath)) {
        try {
          const content = fs.readFileSync(playlistPath, "utf-8");
          if (content.includes(".ts")) {
            clearInterval(interval);
            resolve();
            return;
          }
        } catch {}
      }
      if (session.done && !fs.existsSync(playlistPath)) {
        clearInterval(interval);
        session.failed = true;
        reject(new Error("ffmpeg exited before producing playlist"));
        return;
      }
      if (Date.now() - startedAt > STARTUP_TIMEOUT_MS) {
        clearInterval(interval);
        session.failed = true;
        reject(new Error("HLS startup timeout"));
      }
    }, 200);
  });

  return session;
}

export async function readPlaylist(
  videoId: string,
  chatId: number,
  messageId: number,
): Promise<string> {
  const s = getOrCreateSession(videoId, chatId, messageId);
  await s.ready;
  return fs.readFileSync(s.playlistPath, "utf-8");
}

export async function getSegmentFile(
  videoId: string,
  segName: string,
): Promise<string | null> {
  const s = sessions.get(videoId);
  if (!s) return null;
  if (!/^seg-\d+\.ts$/.test(segName)) return null;
  s.lastAccess = Date.now();
  const p = path.join(s.dir, segName);

  // Wait briefly if the segment hasn't been flushed yet
  const start = Date.now();
  while (!fs.existsSync(p)) {
    if (s.failed) return null;
    if (s.done) return fs.existsSync(p) ? p : null;
    if (Date.now() - start > SEGMENT_WAIT_MS) return null;
    await new Promise((r) => setTimeout(r, 200));
  }
  return p;
}

// Periodic cleanup of stale sessions
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastAccess > SESSION_TTL_MS) {
      try {
        s.ffmpeg?.kill("SIGKILL");
      } catch {}
      try {
        fs.rmSync(s.dir, { recursive: true, force: true });
      } catch {}
      sessions.delete(id);
      logger.info({ id }, "Cleaned up stale HLS session");
    }
  }
}, 60_000).unref();
