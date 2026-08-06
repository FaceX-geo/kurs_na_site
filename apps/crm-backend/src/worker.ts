import { setTimeout as delay } from "node:timers/promises";
import { newPublicId } from "./common/id.js";
import { loadWorkerRuntimeConfig } from "./config/env.js";
import { createDatabase } from "./db/client.js";
import { IntakeRoutingWorker } from "./modules/intake/routing-worker.js";

const config = loadWorkerRuntimeConfig();
const database = createDatabase(config);
const abortController = new AbortController();
const workerId = newPublicId("event");
const worker = new IntakeRoutingWorker(database.db, {
  batchSize: config.worker.batchSize,
  lockTtlSeconds: config.worker.lockTtlSeconds,
  workerId,
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => abortController.abort());
}

try {
  while (!abortController.signal.aborted) {
    const result = await worker.runBatch(abortController.signal);
    if (result.failed > 0) {
      process.stderr.write(`${JSON.stringify({ event: "intake-routing-failed", workerId, ...result })}\n`);
    }
    if (result.claimed === 0) {
      await delay(config.worker.pollIntervalMs, undefined, { signal: abortController.signal }).catch(
        () => undefined,
      );
    }
  }
} finally {
  await database.close();
}
