import { loadDatabaseRuntimeConfig } from "./config/env.js";
import { createDatabase } from "./db/client.js";
import {
  assertTestBypassSessionRevocationGate,
  revokeTestBypassSessions,
  TestBypassSessionRevocationError,
} from "./modules/identity/test-bypass-session-revocation.js";

let database: ReturnType<typeof createDatabase> | undefined;
try {
  assertTestBypassSessionRevocationGate();
  database = createDatabase(loadDatabaseRuntimeConfig());
  const summary = await revokeTestBypassSessions(database.db);
  process.stdout.write(`${JSON.stringify({ status: "TEST_BYPASS_SESSIONS_REVOKED", ...summary })}\n`);
} catch (error) {
  const safeError =
    error instanceof TestBypassSessionRevocationError
      ? { code: error.code, message: error.message }
      : {
          code: "TEST_BYPASS_SESSION_REVOCATION_FAILED",
          message: "Test bypass session revocation failed",
        };
  process.stderr.write(`${JSON.stringify(safeError)}\n`);
  process.exitCode = 1;
} finally {
  await database?.close();
}
