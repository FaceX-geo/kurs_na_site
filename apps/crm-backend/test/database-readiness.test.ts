import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertMigrationRegistryReady, MigrationReadinessError } from "../src/db/client.js";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expected = [
  { version: "0001_core", checksum: "a".repeat(64) },
  { version: "0002_identity", checksum: "b".repeat(64) },
] as const;

function readinessError(run: () => void): MigrationReadinessError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(MigrationReadinessError);
    return error as MigrationReadinessError;
  }
  throw new Error("Expected migration readiness to fail");
}

describe("database migration readiness", () => {
  it("accepts only a complete registry with matching immutable checksums", () => {
    expect(() => assertMigrationRegistryReady(expected, [...expected].reverse())).not.toThrow();
  });

  it("fails closed for an empty bundled manifest or empty database registry", () => {
    expect(readinessError(() => assertMigrationRegistryReady([], expected)).code).toBe(
      "MIGRATION_BUNDLE_EMPTY",
    );
    const emptyRegistry = readinessError(() => assertMigrationRegistryReady(expected, []));
    expect(emptyRegistry.code).toBe("MIGRATION_REGISTRY_EMPTY");
    expect(emptyRegistry.versions).toEqual(["0001_core", "0002_identity"]);
  });

  it("fails closed when a migration is pending", () => {
    const error = readinessError(() => assertMigrationRegistryReady(expected, [expected[0]]));
    expect(error.code).toBe("MIGRATION_PENDING");
    expect(error.versions).toEqual(["0002_identity"]);
  });

  it("fails closed when an applied checksum drifted", () => {
    const error = readinessError(() =>
      assertMigrationRegistryReady(expected, [
        expected[0],
        { version: "0002_identity", checksum: "c".repeat(64) },
      ]),
    );
    expect(error.code).toBe("MIGRATION_CHECKSUM_MISMATCH");
    expect(error.versions).toEqual(["0002_identity"]);
  });

  it("keeps the API readiness path read-only", async () => {
    const source = await readFile(path.join(appRoot, "src/db/client.ts"), "utf8");
    expect(source).toContain('.selectFrom("platform.schema_migration")');
    expect(source).not.toContain("ensureRegistry");
    expect(source).not.toMatch(/CREATE\s+(?:SCHEMA|TABLE)/iu);
  });
});
