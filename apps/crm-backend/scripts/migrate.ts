import { loadDatabaseRuntimeConfig } from "../src/config/env.js";
import { getMigrationStatus, migrateDown, migrateUp } from "../src/db/migrator.js";

const command = process.argv[2] ?? "status";
const config = loadDatabaseRuntimeConfig();

switch (command) {
  case "up": {
    const applied = await migrateUp(config.databaseUrl);
    process.stdout.write(`${JSON.stringify({ status: "ok", applied })}\n`);
    break;
  }
  case "status": {
    const migrations = await getMigrationStatus(config.databaseUrl);
    const invalid = migrations.filter((migration) => migration.state === "checksum_mismatch");
    process.stdout.write(
      `${JSON.stringify({ status: invalid.length === 0 ? "ok" : "invalid", migrations })}\n`,
    );
    process.exitCode = invalid.length === 0 ? 0 : 1;
    break;
  }
  case "down": {
    const reverted = await migrateDown(config.databaseUrl);
    process.stdout.write(`${JSON.stringify({ status: "ok", reverted })}\n`);
    break;
  }
  default:
    throw new Error(`Unknown migration command: ${command}`);
}
