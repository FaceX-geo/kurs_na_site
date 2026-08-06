import { toSafeMigrationError } from "./modules/migration/index.js";
import {
  materializeJuly22TestSnapshot,
  readTestSnapshotMaterializationConfig,
} from "./modules/migration/test-snapshot-materializer.js";

try {
  const summary = await materializeJuly22TestSnapshot(readTestSnapshotMaterializationConfig());
  process.stdout.write(`${JSON.stringify({ status: "TEST_SNAPSHOT_MATERIALIZED", ...summary })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify(toSafeMigrationError(error))}\n`);
  process.exitCode = 1;
}
