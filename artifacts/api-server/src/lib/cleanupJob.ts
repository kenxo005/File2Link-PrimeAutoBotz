import { db, filesTable, broadcastsTable } from "@workspace/db";
import { lt } from "drizzle-orm";
import { logger } from "./logger.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const RUN_INTERVAL_MS = 60 * 60 * 1000;        // run every hour (DB cleanup)
const MEMORY_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // run every 5 minutes (memory cleanup)
const FILE_TTL_MS = 24 * 60 * 60 * 1000;       // delete files older than 24h
const BROADCAST_TTL_MS = 7 * 24 * 60 * 60 * 1000; // keep broadcasts 7 days

// Track memory usage
let lastMemoryLog = Date.now();
let peakMemory = 0;

async function runCleanup(): Promise<void> {
  try {
    const fileCutoff = new Date(Date.now() - FILE_TTL_MS);
    const broadcastCutoff = new Date(Date.now() - BROADCAST_TTL_MS);

    const deletedFiles = await db
      .delete(filesTable)
      .where(lt(filesTable.createdAt, fileCutoff))
      .returning({ id: filesTable.id });

    const deletedBroadcasts = await db
      .delete(broadcastsTable)
      .where(lt(broadcastsTable.createdAt, broadcastCutoff))
      .returning({ id: broadcastsTable.id });

    if (deletedFiles.length > 0 || deletedBroadcasts.length > 0) {
      logger.info(
        { files: deletedFiles.length, broadcasts: deletedBroadcasts.length },
        "Cleanup job removed expired records",
      );
    }
  } catch (err) {
    logger.error({ err }, "Cleanup job failed");
  }
}

/**
 * Memory cleanup - runs frequently without affecting active streams
 * - Removes orphaned temporary HLS directories
 * - Clears Node.js memory buffers
 * - Logs memory usage patterns
 */
async function runMemoryCleanup(): Promise<void> {
  try {
    const before = process.memoryUsage();
    const hlsTmpRoot = path.join(os.tmpdir(), "f2l-hls");

    // Clean up orphaned HLS directories (older than 5 minutes without active streams)
    if (fs.existsSync(hlsTmpRoot)) {
      const now = Date.now();
      const entries = fs.readdirSync(hlsTmpRoot, { withFileTypes: true });
      
      let cleanedCount = 0;
      for (const entry of entries) {
        if (entry.isDirectory()) {
          try {
            const fullPath = path.join(hlsTmpRoot, entry.name);
            const stat = fs.statSync(fullPath);
            const ageMs = now - stat.mtimeMs;
            
            // Remove directories older than 10 minutes (safe window after 2-min session TTL)
            if (ageMs > 10 * 60 * 1000) {
              fs.rmSync(fullPath, { recursive: true, force: true });
              cleanedCount++;
            }
          } catch {
            // Ignore errors for individual directories
          }
        }
      }
      
      if (cleanedCount > 0) {
        logger.debug({ cleaned: cleanedCount }, "Memory cleanup: removed orphaned HLS directories");
      }
    }

    // Force garbage collection if memory usage is high
    if (global.gc) {
      const heapUsedPercent = (before.heapUsed / before.heapTotal) * 100;
      if (heapUsedPercent > 80) {
        global.gc();
        logger.debug(
          { heapUsedPercent: heapUsedPercent.toFixed(1) },
          "Memory cleanup: triggered garbage collection",
        );
      }
    }

    // Log memory usage periodically (every 30 seconds)
    const now = Date.now();
    if (now - lastMemoryLog > 30_000) {
      const after = process.memoryUsage();
      const heapUsedMB = (after.heapUsed / 1024 / 1024).toFixed(1);
      const heapTotalMB = (after.heapTotal / 1024 / 1024).toFixed(1);
      const rssMB = (after.rss / 1024 / 1024).toFixed(1);
      
      if (after.heapUsed > peakMemory) {
        peakMemory = after.heapUsed;
      }
      
      const peakMB = (peakMemory / 1024 / 1024).toFixed(1);
      
      logger.debug(
        {
          heap: `${heapUsedMB}MB / ${heapTotalMB}MB`,
          rss: `${rssMB}MB`,
          peak: `${peakMB}MB`,
        },
        "Memory status",
      );
      
      lastMemoryLog = now;
    }
  } catch (err) {
    logger.error({ err }, "Memory cleanup job failed");
  }
}

export function startCleanupJob(): void {
  // Database cleanup: run shortly after startup, then every hour
  setTimeout(runCleanup, 30_000).unref();
  setInterval(runCleanup, RUN_INTERVAL_MS).unref();
  
  // Memory cleanup: run frequently (every 5 minutes) without affecting active streams
  setTimeout(runMemoryCleanup, 15_000).unref();
  setInterval(runMemoryCleanup, MEMORY_CLEANUP_INTERVAL_MS).unref();
  
  logger.info("Cleanup jobs scheduled (hourly DB cleanup, 5-min memory cleanup)");
}
