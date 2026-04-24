import type { Request, Response } from "express";
import { logger } from "./logger.js";
import { streamFileByMessage } from "./gramjsClient.js";

export async function streamTelegramFile(
  req: Request,
  res: Response,
  chatId: number,
  messageId: number,
  mimeType: string | null | undefined,
  fileName: string | null | undefined,
  fileSize: number | null | undefined,
  isDownload = false,
): Promise<void> {
  try {
    const contentType = mimeType || "application/octet-stream";
    const rangeHeader = req.headers["range"];

    // Cache for 24 hours — files are immutable once uploaded
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");

    let aborted = false;
    req.on("close", () => { aborted = true; });

    // Backpressure-aware writer: pauses MTProto pulls when the socket is full,
    // keeping memory bounded even on Railway free tier.
    const writeWithBackpressure = async (chunk: Buffer): Promise<boolean> => {
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

    if (rangeHeader && fileSize) {
      const parts = rangeHeader.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0] ?? "0", 10);
      // 16 MB ranges — fewer round trips, better throughput, still bounded memory
      const end = parts[1]
        ? parseInt(parts[1], 10)
        : Math.min(start + 16 * 1024 * 1024 - 1, fileSize - 1);
      const chunkSize = end - start + 1;

      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Length", String(chunkSize));
      res.setHeader("Content-Type", contentType);
      if (isDownload) {
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${sanitizeFileName(fileName || "file")}"`,
        );
      }

      await streamFileByMessage(chatId, messageId, writeWithBackpressure, start, chunkSize);
      if (!aborted) res.end();
      return;
    }

    // Full-file stream
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Type", contentType);
    if (fileSize) res.setHeader("Content-Length", String(fileSize));
    if (isDownload) {
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${sanitizeFileName(fileName || "file")}"`,
      );
    } else {
      res.setHeader("Content-Disposition", "inline");
    }

    await streamFileByMessage(chatId, messageId, writeWithBackpressure);

    if (!aborted) res.end();
  } catch (err) {
    logger.error({ err }, "Error streaming Telegram file via MTProto");
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to stream file. Please try again." });
    }
  }
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, "_");
}
