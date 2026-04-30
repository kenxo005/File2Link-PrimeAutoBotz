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
  let aborted = false;
  let bytesWritten = 0;
  let lastChunkTime = Date.now();
  const startTime = Date.now();
  const STALL_TIMEOUT = 30 * 1000; // 30 seconds without data
  
  try {
    const contentType = mimeType || "application/octet-stream";
    const rangeHeader = req.headers["range"];

    // Cache for 24 hours — files are immutable once uploaded
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");

    const onAbort = () => { 
      aborted = true;
      logger.info({
        chatId,
        messageId,
        fileName,
        fileType: isDownload ? "download" : "stream",
        bytesWritten,
        duration: Date.now() - startTime,
        rangeRequested: !!rangeHeader
      }, "Client disconnected from stream");
    };
    
    const onSocketError = (err: Error) => {
      aborted = true;
      logger.error({
        err,
        chatId,
        messageId,
        fileName,
        bytesWritten,
        duration: Date.now() - startTime
      }, "Socket error during streaming");
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
          fileName,
          bytesWritten,
          stallDuration: timeSinceLastChunk,
          duration: Date.now() - startTime
        }, "Stream stalled, aborting");
        try {
          if (!res.writableEnded) {
            res.destroy();
          }
        } catch {}
      }
    }, 5 * 1000); // Check every 5 seconds

    // Backpressure-aware writer with error handling
    const writeWithBackpressure = async (chunk: Buffer): Promise<boolean> => {
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
              logger.error({ err }, "Backpressure error");
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
        logger.error({ err }, "Write error during streaming");
        aborted = true;
        return false;
      }
    };
    
    // Optimize socket buffer for faster streaming
    const socket = res.socket;
    if (socket && !socket.writableNeedsDrain) {
      try {
        // Set larger send buffer for better throughput (up to 1MB for 1GB/s speeds)
        socket.setNoDelay(true);
        if (typeof socket.setWriteQueueHighWaterMark === 'function') {
          socket.setWriteQueueHighWaterMark(1024 * 1024); // 1MB buffer for massive throughput
        }
        // Also increase TCP send buffer if possible
        if (typeof socket.setWriteQueueSize === 'function') {
          socket.setWriteQueueSize(2 * 1024 * 1024); // 2MB send queue
        }
      } catch {}
    }

    if (rangeHeader && fileSize) {
      const parts = rangeHeader.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0] ?? "0", 10);
      // 32 MB ranges — fewer round trips, better throughput, still bounded memory (doubled from 16MB)
      const end = parts[1]
        ? parseInt(parts[1], 10)
        : Math.min(start + 256 * 1024 * 1024 - 1, fileSize - 1);
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

      try {
        await streamFileByMessage(chatId, messageId, writeWithBackpressure, start, chunkSize);
        if (!aborted) res.end();
      } catch (streamErr) {
        logger.error({ err: streamErr, chatId, messageId }, "Range stream failed");
        if (!res.headersSent) res.status(500).json({ error: "Failed to stream file. Please try again." });
        else if (!res.writableEnded) res.destroy();
      }
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

    try {
      await streamFileByMessage(chatId, messageId, writeWithBackpressure);
      if (!aborted) res.end();
    } catch (streamErr) {
      logger.error({ err: streamErr, chatId, messageId }, "Full stream failed");
      if (!res.headersSent) res.status(500).json({ error: "Failed to stream file. Please try again." });
      else if (!res.writableEnded) res.destroy();
    }
  } catch (err) {
    logger.error({ 
      err, 
      chatId,
      messageId,
      fileName,
      bytesWritten: bytesWritten || 0,
      duration: Date.now() - startTime
    }, "Error streaming Telegram file via MTProto");
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to stream file. Please try again." });
    } else {
      try {
        if (!res.writableEnded) {
          res.destroy();
        }
      } catch {}
    }
  } finally {
    try {
      req.off("close", onAbort);
      req.off("error", onAbort);
      if (res.socket) {
        res.socket.off("error", onSocketError);
      }
      clearInterval(stallDetector);
    } catch {}
  }
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, "_");
}
