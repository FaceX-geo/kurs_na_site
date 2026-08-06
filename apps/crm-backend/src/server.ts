import { buildApp } from "./app.js";
import { composeApplication } from "./composition.js";
import { loadConfig } from "./config/env.js";
import { createDatabase } from "./db/client.js";

const config = loadConfig();
const database = createDatabase(config);
const composition = composeApplication(config, database);
const app = await buildApp(config, {
  database,
  readinessChecks: composition.readinessChecks,
  registerRoutes: (instance) => composition.registerRoutes(instance),
});

let closing = false;
async function shutdown(signal: string) {
  if (closing) {
    return;
  }
  closing = true;
  app.log.info({ signal }, "graceful shutdown started");
  await app.close();
  await database.close();
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.fatal({ err: error }, "server startup failed");
  await database.close();
  process.exitCode = 1;
}
