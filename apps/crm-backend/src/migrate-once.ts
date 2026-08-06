import { loadDatabaseRuntimeConfig } from "./config/env.js";
import { migrateUp } from "./db/migrator.js";

const config = loadDatabaseRuntimeConfig();
const applied = await migrateUp(config.databaseUrl);
process.stdout.write(`${JSON.stringify({ status: "ok", applied })}\n`);
