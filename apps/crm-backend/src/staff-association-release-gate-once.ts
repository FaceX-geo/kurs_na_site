import { loadDatabaseRuntimeConfig } from "./config/env.js";
import { toSafeMigrationError } from "./modules/migration/index.js";
import { createStaffAssociationClient } from "./modules/migration/staff-association-reconciliation.js";
import { runStaffAssociationReleaseGate } from "./modules/migration/staff-association-release-gate.js";

try {
  const config = loadDatabaseRuntimeConfig();
  const summary = await runStaffAssociationReleaseGate(() =>
    createStaffAssociationClient(config.databaseUrl),
  );
  process.stdout.write(
    `${JSON.stringify({ status: "LEGACY_STAFF_ASSOCIATION_RELEASE_GATE_PASSED", ...summary })}\n`,
  );
} catch (error) {
  process.stderr.write(`${JSON.stringify(toSafeMigrationError(error))}\n`);
  process.exitCode = 1;
}
