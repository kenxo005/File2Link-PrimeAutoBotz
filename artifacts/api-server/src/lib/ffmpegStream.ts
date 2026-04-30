import type { Request, Response } from "express";
import { streamFileByMessage } from "./gramjsClient.js";
import { logger } from "./logger.js";

/**
 * Streams a Telegram video.
 *
 * All files — regardless of size — use the same direct range-streaming path
 * from Telegram via MTProto. No small/large file partition.
 */
export async function streamVideoFast(
  req: Request,
  res: Response,
  _videoId: string,
  chatId: number,
  messageId: number,
  mimeType: string | null | undefined,
  _fileName: string | null | undefined,
  fileSize: number | null | undefined,
): Promise<void> {
  await streamDirect(req, res, chatId, messageId, mimeType, fileSize ?? 0);
}

async function streamDirect(
  req: Request,
  res: Response,
  chatId: number,
  messageId: number,
  mimeType: string | null | undefined,
  fileSize: number,
): Promise<void> {
  let aborted = false;
  let bytesWritten = 0;
  let lastChunkTime = Date.now();
  const startTime = Date.now();
  const STALL_TIMEOUT = 30 * 1000; // 30 seconds without data
  
  const onAbort = () => { 
    aborted = true;
    logger.info({ 
      chatId, 
      messageId,
      bytesWritten,
      mimeType,
      duration: Date.now() - startTime,
      rangeRequested: !!req.headers["range"]
    }, "streamDirect: client disconnected/aborted");
  };
  
  const onSocketError = (err: Error) => {
    aborted = true;
    logger.error({ 
      err, 
      chatId, 
      messageId,
      bytesWritten,
      duration: Date.now() - startTime
    }, "streamDirect: socket error");
  };
  
  req.on("close", onAbort);
  req.on("error", onAbort);
  res.socket?.on("error", onSocketError);

  // Timeout detection for stalled streams
  const stallDetector = setInterval(() => {
    const timeSinceLastChunk = Date.now() - lastChunkTime;
    if (timeSinceLastChunk > STALL_TIMEOUT && !aborted && bytesWritten > 0) {
      aborted = true;
      logger.warn({
        chatId,
        messageId,
        bytesWritten,
        stallDuration: timeSinceLastChunk,
        duration: Date.now() - startTime
      }, "streamDirect: stream stalled, aborting");
      try {
        if (!res.writableEnded) {
          res.destroy();
        }
      } catch {}
    }
  }, 5 * 1000); // Check every 5 seconds

  try {
    const contentType = mimeType || "video/mp4";
    const rangeHeader = req.headers["range"];

    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    
    // Streaming optimization headers
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");

    const writeBP = async (chunk: Buffer): Promise<boolean> => {
      if (aborted) return false;
      
      try {
        lastChunkTime = Date.now();
        bytesWritten += chunk.length;
        const ok = res.write(chunk);
        
        if (!ok) {
          // Backpressure: wait for drain or abort
          await new Promise<void>((resolve) => {
            let resolved = false;
            const onDrain = () => {
              if (resolved) return;
              resolved = true;
              res.off("close", onClose);
              res.off("error", onError);
              resolve();
            };
            const onClose = () => {
              if (resolved) return;
              resolved = true;
              res.off("drain", onDrain);
              res.off("error", onError);
              aborted = true;
              resolve();
            };
            const onError = (err: Error) => {
              if (resolved) return;
              resolved = true;
              res.off("drain", onDrain);
              res.off("close", onClose);
              logger.error({ err }, "streamDirect: backpressure error");
              aborted = true;
              resolve();
            };
            
            res.once("drain", onDrain);
            res.once("close", onClose);
            res.once("error", onError);
          });
        }
        return !aborted;
      } catch (err) {
        logger.error({ err }, "streamDirect: write error");
        aborted = true;
        return false;
      }
    };
    
    // Optimize socket for streaming
    const socket = res.socket;
    if (socket && !socket.writableNeedsDrain) {
      try {
        socket.setNoDelay(true);
        if (typeof socket.setWriteQueueHighWaterMark === 'function') {
          socket.setWriteQueueHighWaterMark(1024 * 1024); // 1MB buffer for 1GB/s speeds
        }
        if (typeof socket.setWriteQueueSize === 'function') {
          socket.setWriteQueueSize(2 * 1024 * 1024); // 2MB send queue
        }
      } catch {}
    }

    if (rangeHeader) {
      const parts = rangeHeader.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0] ?? "0", 10);
      // 32 MB ranges for video streaming (doubled from 16MB) = even fewer round trips, faster seek
      const end = parts[1]
        ? parseInt(parts[1], 10)
        : Math.min(start + 256 * 1024 * 1024 - 1, fileSize - 1);
      const chunkSize = end - start + 1;

      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Length", String(chunkSize));
      res.setHeader("Content-Type", contentType);

      logger.debug({ 
        chatId, 
        messageId,
        mimeType,
        rangeStart: start,
        rangeEnd: end,
        chunkSize
      }, "streamDirect: 206 range request");

      try {
        await streamFileByMessage(chatId, messageId, writeBP, start, chunkSize);
        if (!aborted) res.end();
      } catch (streamErr) {
        logger.error({ err: streamErr, chatId, messageId }, "streamDirect: range request failed");
        if (!res.headersSent) res.status(500).send("Stream interrupted");
        else if (!res.writableEnded) res.destroy();
      }
    } else {
      res.status(200);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Length", String(fileSize));

      logger.debug({ 
        chatId, 
        messageId,
        mimeType,
        fileSize
      }, "streamDirect: full file stream (200)");

      try {
        await streamFileByMessage(chatId, messageId, writeBP);
        if (!aborted) res.end();
      } catch (streamErr) {
        logger.error({ err: streamErr, chatId, messageId }, "streamDirect: full stream failed");
        if (!res.headersSent) res.status(500).send("Stream interrupted");
        else if (!res.writableEnded) res.destroy();
      }
    }
  } catch (err) {
    logger.error({ 
      err, 
      chatId,
      messageId,
      bytesWritten,
      mimeType,
      duration: Date.now() - startTime
    }, "streamDirect error");
    if (!res.headersSent) res.status(500).send("Streaming error");
    else if (!res.writableEnded) {
      try {
        res.destroy();
      } catch {}
    }
  } finally {
    clearInterval(stallDetector);
    req.off("close", onAbort);
    req.off("error", onAbort);
    if (res.socket) {
      res.socket.off("error", onSocketError);
    }
  }
}
