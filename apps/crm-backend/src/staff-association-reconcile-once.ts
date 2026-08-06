import { loadDatabaseRuntimeConfig } from "./config/env.js";
import { toSafeMigrationError } from "./modules/migration/index.js";
import {
  createStaffAssociationClient,
  reconcileLegacyStaffAssociations,
} from "./modules/migration/staff-association-reconciliation.js";

try {
  const config = loadDatabaseRuntimeConfig();
  const summary = await reconcileLegacyStaffAssociations(createStaffAssociationClient(config.databaseUrl));
  const { status: readiness, ...details } = summary;
  process.stdout.write(
    `${JSON.stringify({ status: "LEGACY_STAFF_ASSOCIATIONS_RECONCILED", readiness, ...details })}\n`,
  );
  process.exitCode = summary.status === "invalid" ? 2 : 0;
} catch (error) {
  process.stderr.write(`${JSON.stringify(toSafeMigrationError(error))}\n`);
  process.exitCode = 1;
}
