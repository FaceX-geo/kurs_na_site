import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const MIGRATION_PATTERN = /^(?<version>[0-9]{4}_[a-z0-9_]+)\.(?<direction>up|down)\.sql$/;
const ADVISORY_LOCK_KEY = 4_936_470_129;

export interface MigrationDefinition {
  version: string;
  upSql: string;
  downSql?: string;
  checksum: string;
}

export interface MigrationStatus {
  version: string;
  state: "pending" | "applied" | "checksum_mismatch";
  expectedChecksum: string;
  appliedChecksum?: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function defaultMigrationsDirectory(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../db/migrations");
}

export async function readMigrations(
  directory = defaultMigrationsDirectory(),
): Promise<MigrationDefinition[]> {
  const filenames = await readdir(directory);
  const byVersion = new Map<string, { upSql?: string; downSql?: string }>();

  for (const filename of filenames.sort()) {
    const match = MIGRATION_PATTERN.exec(filename);
    if (!match?.groups) {
      continue;
    }
    const version = match.groups.version;
    const direction = match.groups.direction;
    if (!version || (direction !== "up" && direction !== "down")) {
      continue;
    }

    const current = byVersion.get(version) ?? {};
    current[direction === "up" ? "upSql" : "downSql"] = await readFile(
      path.join(directory, filename),
      "utf8",
    );
    byVersion.set(version, current);
  }

  return [...byVersion.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([version, definition]) => {
      if (!definition.upSql) {
        throw new Error(`Migration ${version} is missing an up SQL file`);
      }
      return {
        version,
        upSql: definition.upSql,
        ...(definition.downSql ? { downSql: definition.downSql } : {}),
        checksum: sha256(definition.upSql),
      };
    });
}

async function ensureRegistry(client: Client): Promise<void> {
  await client.query("CREATE SCHEMA IF NOT EXISTS platform");
  await client.query(`
    CREATE TABLE IF NOT EXISTS platform.schema_migration (
      version text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )
  `);
}

async function appliedMigrations(client: Client): Promise<Map<string, string>> {
  await ensureRegistry(client);
  const result = await client.query<{ version: string; checksum: string }>(
    "SELECT version, checksum FROM platform.schema_migration ORDER BY version",
  );
  return new Map(result.rows.map((row) => [row.version, row.checksum]));
}

export async function getMigrationStatus(databaseUrl: string): Promise<MigrationStatus[]> {
  const migrations = await readMigrations();
  const client = new Client({ connectionString: databaseUrl, application_name: "kurs-crm-migrator" });
  await client.connect();
  try {
    const applied = await appliedMigrations(client);
    return migrations.map((migration) => {
      const appliedChecksum = applied.get(migration.version);
      if (!appliedChecksum) {
        return {
          version: migration.version,
          state: "pending" as const,
          expectedChecksum: migration.checksum,
        };
      }
      return {
        version: migration.version,
        state: appliedChecksum === migration.checksum ? ("applied" as const) : ("checksum_mismatch" as const),
        expectedChecksum: migration.checksum,
        appliedChecksum,
      };
    });
  } finally {
    await client.end();
  }
}

export async function migrateUp(databaseUrl: string): Promise<string[]> {
  const migrations = await readMigrations();
  const client = new Client({ connectionString: databaseUrl, application_name: "kurs-crm-migrator" });
  await client.connect();
  const appliedNow: string[] = [];

  try {
    await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
    const applied = await appliedMigrations(client);

    for (const migration of migrations) {
      const existingChecksum = applied.get(migration.version);
      if (existingChecksum && existingChecksum !== migration.checksum) {
        throw new Error(`Applied migration ${migration.version} checksum changed`);
      }
      if (existingChecksum) {
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(migration.upSql);
        await client.query("INSERT INTO platform.schema_migration (version, checksum) VALUES ($1, $2)", [
          migration.version,
          migration.checksum,
        ]);
        await client.query("COMMIT");
        appliedNow.push(migration.version);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]).catch(() => undefined);
    await client.end();
  }

  return appliedNow;
}

export async function migrateDown(databaseUrl: string): Promise<string> {
  if (process.env.ALLOW_DESTRUCTIVE_MIGRATION_DOWN !== "true") {
    throw new Error("Refusing destructive rollback without ALLOW_DESTRUCTIVE_MIGRATION_DOWN=true");
  }

  const migrations = await readMigrations();
  const client = new Client({ connectionString: databaseUrl, application_name: "kurs-crm-migrator" });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
    const applied = await appliedMigrations(client);
    const latest = migrations.filter((migration) => applied.has(migration.version)).at(-1);
    if (!latest) {
      throw new Error("No applied migration to roll back");
    }
    if (!latest.downSql) {
      throw new Error(`Migration ${latest.version} does not provide a down migration`);
    }

    await client.query("BEGIN");
    try {
      await client.query("DELETE FROM platform.schema_migration WHERE version = $1", [latest.version]);
      await client.query(latest.downSql);
      await client.query("COMMIT");
      return latest.version;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]).catch(() => undefined);
    await client.end();
  }
}
