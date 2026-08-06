import { loadConfig } from "./config/env.js";
import { createDatabase } from "./db/client.js";
import { createObjectStore } from "./modules/intake/object-storage.js";
import { PostgresIntakeAdapter } from "./modules/intake/postgres-adapter.js";

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Reconciliation option must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

const config = loadConfig();
const database = createDatabase(config);
try {
  const staleHours = boundedInteger(process.env.UPLOAD_RECONCILE_STALE_HOURS, 48, 25, 720);
  const cleanupRetryMinutes = boundedInteger(process.env.UPLOAD_RECONCILE_RETRY_MINUTES, 15, 5, 1_440);
  const batchSize = boundedInteger(process.env.UPLOAD_RECONCILE_BATCH_SIZE, 100, 1, 500);
  const now = Date.now();
  const adapter = new PostgresIntakeAdapter(database.db, config, createObjectStore(config));
  const result = await adapter.reconcileAbandonedUploadObjects({
    staleBefore: new Date(now - staleHours * 60 * 60_000),
    cleanupRetryBefore: new Date(now - cleanupRetryMinutes * 60_000),
    batchSize,
  });
  process.stdout.write(`${JSON.stringify({ status: "ok", ...result })}\n`);
  process.exitCode = result.failed === 0 ? 0 : 1;
} finally {
  await database.close();
}
