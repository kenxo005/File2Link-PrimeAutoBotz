import { db, filesTable, broadcastsTable } from "@workspace/db";
import { lt } from "drizzle-orm";
import { logger } from "./logger.js";

const RUN_INTERVAL_MS = 60 * 60 * 1000;        // run every hour
const FILE_TTL_MS = 24 * 60 * 60 * 1000;       // delete files older than 24h
const BROADCAST_TTL_MS = 7 * 24 * 60 * 60 * 1000; // keep broadcasts 7 days

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

export function startCleanupJob(): void {
  // Run shortly after startup, then every hour
  setTimeout(runCleanup, 30_000).unref();
  setInterval(runCleanup, RUN_INTERVAL_MS).unref();
  logger.info("Cleanup job scheduled (hourly)");
}
