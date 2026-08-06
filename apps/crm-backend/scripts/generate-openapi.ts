import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildApp } from "../src/app.js";
import { composeApplication } from "../src/composition.js";
import { loadConfig } from "../src/config/env.js";
import { createDatabase } from "../src/db/client.js";

const config = loadConfig({
  ...process.env,
  NODE_ENV: "test",
  OBJECT_STORAGE_DRIVER: "memory",
});
const database = createDatabase(config);
const composition = composeApplication(config, database);
const app = await buildApp(config, {
  database,
  readinessChecks: composition.readinessChecks,
  registerRoutes: (instance) => composition.registerRoutes(instance),
});

try {
  await app.ready();
  const outputDirectory = path.resolve("openapi");
  const outputPath = path.join(outputDirectory, "openapi.json");
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(app.swagger(), null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ status: "ok", outputPath })}\n`);
} finally {
  await app.close();
  await database.close();
}
