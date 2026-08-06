import { setTimeout as delay } from "node:timers/promises";
import { newPublicId } from "./common/id.js";
import { loadCredentialWorkerRuntimeConfig } from "./config/env.js";
import { createDatabase } from "./db/client.js";
import {
  CredentialDeliveryWorker,
  PostgresCredentialDeliveryQueue,
  SignedHttpsWebhookCredentialProvider,
} from "./modules/identity/credential-delivery/index.js";

function configurationFailureCode(error: unknown): string {
  if (error && typeof error === "object" && "issues" in error && Array.isArray(error.issues)) {
    const paths = error.issues.map((issue) =>
      issue && typeof issue === "object" && "path" in issue && Array.isArray(issue.path)
        ? String(issue.path[0] ?? "")
        : "",
    );
    if (paths.includes("CREDENTIAL_DELIVERY_PROVIDER_URL")) {
      return "CREDENTIAL_PROVIDER_URL_REQUIRED_OR_INVALID";
    }
    if (paths.includes("CREDENTIAL_DELIVERY_SIGNING_SECRET")) {
      return "CREDENTIAL_SIGNING_SECRET_REQUIRED_OR_INVALID";
    }
    if (paths.includes("CREDENTIAL_DELIVERY_TOKEN_SECRET")) {
      return "CREDENTIAL_TOKEN_SECRET_REQUIRED_OR_INVALID";
    }
    if (paths.includes("DATABASE_URL")) {
      return "CREDENTIAL_WORKER_DATABASE_URL_REQUIRED";
    }
    return "CREDENTIAL_WORKER_CONFIGURATION_INVALID";
  }
  return "CREDENTIAL_WORKER_RUNTIME_FAILED";
}

async function main(): Promise<void> {
  const config = loadCredentialWorkerRuntimeConfig();
  const database = createDatabase(config);
  const abortController = new AbortController();
  const workerId = newPublicId("event");
  const queue = new PostgresCredentialDeliveryQueue(database.db, {
    workerId,
    lockTtlSeconds: config.worker.lockTtlSeconds,
  });
  const provider = new SignedHttpsWebhookCredentialProvider({
    url: config.credentialDelivery.providerUrl,
    signingSecret: config.credentialDelivery.signingSecret,
    requestTimeoutMs: config.credentialDelivery.requestTimeoutMs,
  });
  const worker = new CredentialDeliveryWorker(queue, provider, {
    batchSize: config.worker.batchSize,
    maxAttempts: config.worker.maxAttempts,
    baseBackoffMs: config.worker.baseBackoffMs,
    maxBackoffMs: config.worker.maxBackoffMs,
    tokenSecret: config.credentialDelivery.tokenSecret,
  });

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => abortController.abort());
  }

  try {
    while (!abortController.signal.aborted) {
      const result = await worker.runBatch(abortController.signal);
      if (result.claimed > 0) {
        const record = {
          event: "credential-delivery-batch",
          eventCode: "CREDENTIAL_DELIVERY_BATCH_COMPLETED",
          workerId,
          ...result,
        };
        const stream = result.deadLettered > 0 ? process.stderr : process.stdout;
        stream.write(`${JSON.stringify(record)}\n`);
      }
      if (result.claimed === 0) {
        await delay(config.worker.pollIntervalMs, undefined, {
          signal: abortController.signal,
        }).catch(() => undefined);
      }
    }
  } finally {
    await database.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      event: "credential-worker-startup-refused",
      eventCode: configurationFailureCode(error),
    })}\n`,
  );
  process.exitCode = 1;
});
