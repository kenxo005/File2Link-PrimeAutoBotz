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
  req.on("close", () => { aborted = true; });

  try {
    const contentType = mimeType || "video/mp4";
    const rangeHeader = req.headers["range"];

    res.setHeader("Cache-Control", "public, max-age=86400, immutable");

    const writeBP = async (chunk: Buffer): Promise<boolean> => {
      if (aborted) return false;
      const ok = res.write(chunk);
      if (!ok) {
        await new Promise<void>((resolve) => {
          const onDrain = () => { res.off("close", onClose); resolve(); };
          const onClose = () => { res.off("drain", onDrain); aborted = true; resolve(); };
          res.once("drain", onDrain);
          res.once("close", onClose);
        });
      }
      return !aborted;
    };

    if (rangeHeader) {
      const parts = rangeHeader.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0] ?? "0", 10);
      // 16 MB ranges for video streaming = fewer round trips, faster seek
      const end = parts[1]
        ? parseInt(parts[1], 10)
        : Math.min(start + 16 * 1024 * 1024 - 1, fileSize - 1);
      const chunkSize = end - start + 1;

      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Length", String(chunkSize));
      res.setHeader("Content-Type", contentType);

      await streamFileByMessage(chatId, messageId, writeBP, start, chunkSize);

      if (!aborted) res.end();
    } else {
      res.status(200);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Length", String(fileSize));

      await streamFileByMessage(chatId, messageId, writeBP);

      if (!aborted) res.end();
    }
  } catch (err) {
    logger.error({ err }, "streamDirect error");
    if (!res.headersSent) res.status(500).send("Streaming error");
  }
}
