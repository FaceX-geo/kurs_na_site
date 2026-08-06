import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { AppConfig } from "../config/env.js";
import { type MigrationDefinition, readMigrations } from "./migrator.js";
import type { Database } from "./types.js";

export interface DatabaseHandle {
  db: Kysely<Database>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

export interface AppliedMigrationRecord {
  readonly version: string;
  readonly checksum: string;
}

export type MigrationReadinessErrorCode =
  | "MIGRATION_BUNDLE_EMPTY"
  | "MIGRATION_CHECKSUM_MISMATCH"
  | "MIGRATION_PENDING"
  | "MIGRATION_REGISTRY_EMPTY"
  | "MIGRATION_REGISTRY_UNAVAILABLE";

export class MigrationReadinessError extends Error {
  readonly code: MigrationReadinessErrorCode;
  readonly versions: readonly string[];

  constructor(code: MigrationReadinessErrorCode, versions: readonly string[] = [], options?: ErrorOptions) {
    super(
      versions.length > 0
        ? `Database migrations are not ready (${code}): ${versions.join(", ")}`
        : `Database migrations are not ready (${code})`,
      options,
    );
    this.name = "MigrationReadinessError";
    this.code = code;
    this.versions = versions;
  }
}

/**
 * Compares the immutable bundled migration manifest with the read-only database registry.
 * The API role never creates or repairs the registry: any absence or drift keeps readiness closed.
 */
export function assertMigrationRegistryReady(
  expected: readonly Pick<MigrationDefinition, "version" | "checksum">[],
  applied: readonly AppliedMigrationRecord[],
): void {
  if (expected.length === 0) {
    throw new MigrationReadinessError("MIGRATION_BUNDLE_EMPTY");
  }
  if (applied.length === 0) {
    throw new MigrationReadinessError(
      "MIGRATION_REGISTRY_EMPTY",
      expected.map((migration) => migration.version),
    );
  }

  const appliedByVersion = new Map(applied.map((migration) => [migration.version, migration.checksum]));
  const mismatched = expected
    .filter((migration) => {
      const appliedChecksum = appliedByVersion.get(migration.version);
      return appliedChecksum !== undefined && appliedChecksum !== migration.checksum;
    })
    .map((migration) => migration.version);
  if (mismatched.length > 0) {
    throw new MigrationReadinessError("MIGRATION_CHECKSUM_MISMATCH", mismatched);
  }

  const pending = expected
    .filter((migration) => !appliedByVersion.has(migration.version))
    .map((migration) => migration.version);
  if (pending.length > 0) {
    throw new MigrationReadinessError("MIGRATION_PENDING", pending);
  }
}

export function createDatabase(config: Pick<AppConfig, "databaseUrl">): DatabaseHandle {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 20,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    application_name: "kurs-na-sever-crm-backend",
  });
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  let expectedMigrations: Promise<MigrationDefinition[]> | undefined;

  const loadExpectedMigrations = () => {
    expectedMigrations ??= readMigrations();
    return expectedMigrations;
  };

  return {
    db,
    async ping() {
      const expected = await loadExpectedMigrations();
      let applied: AppliedMigrationRecord[];
      try {
        applied = await db
          .selectFrom("platform.schema_migration")
          .select(["version", "checksum"])
          .orderBy("version")
          .execute();
      } catch (error) {
        throw new MigrationReadinessError("MIGRATION_REGISTRY_UNAVAILABLE", [], { cause: error });
      }
      assertMigrationRegistryReady(expected, applied);
    },
    async close() {
      await db.destroy();
    },
  };
}
