import { newPublicId } from "./common/id.js";
import { loadWorkerRuntimeConfig } from "./config/env.js";
import { createDatabase } from "./db/client.js";
import { IntakeRoutingWorker } from "./modules/intake/routing-worker.js";

const config = loadWorkerRuntimeConfig();
const database = createDatabase(config);
try {
  const worker = new IntakeRoutingWorker(database.db, {
    batchSize: config.worker.batchSize,
    lockTtlSeconds: config.worker.lockTtlSeconds,
    workerId: newPublicId("event"),
  });
  const result = await worker.runBatch();
  process.stdout.write(`${JSON.stringify({ status: "ok", ...result })}\n`);
} finally {
  await database.close();
}
