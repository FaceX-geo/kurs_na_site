import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type {
  AtomicMigrationRequest,
  MigrationPlan,
  MigrationPreflightReport,
  MysqlConnectionLike,
  MysqlPoolLike,
  MysqlQueryLike,
  PgPoolLike,
  PgQueryResultLike,
} from "../src/modules/migration/index.js";
import {
  executeMigration,
  MysqlLegacySource,
  PostgresMigrationUnitOfWork,
  SafeDryRunClassifier,
} from "../src/modules/migration/index.js";

const snapshotSha256 = "b".repeat(64);
const runId = "0190f1f2-3a4b-7c8d-9e0f-123456789abc";

function migrationPlan(): MigrationPlan {
  return {
    adapterRequirement: "mysql2-backed LegacySourcePort",
    blockerCodes: [],
    generatedAt: "2026-08-06T12:00:00.000Z",
    items: [
      {
        classifierId: "unregistered-transform-quarantine-v1",
        countSql: "SELECT COUNT(*) AS source_rows FROM `b_crm_contact`",
        dependsOn: [],
        expectedProjectionCounts: {
          would_conflict: 0,
          would_exclude: 0,
          would_migrate: 0,
          would_quarantine: 2,
        },
        expectedRows: 2,
        extractionSql: "SELECT `ID`, `EMAIL` FROM `b_crm_contact` ORDER BY `ID`",
        queryId: "MIG-Q-CONTACTS-V1",
        sourceDisposition: "include_row_ledger",
        sourceKey: { columns: ["ID"], kind: "primary_key" },
        sourceTable: "b_crm_contact",
        targets: ["crm.crm_profile"],
        transformVersion: "contact-v1",
        validationRules: ["test fallback"],
      },
    ],
    manifestVersion: "test-v1",
    snapshotSha256,
    sourceSystem: "bitrix",
    totalExpectedRows: 2,
    totalExpectedProjectionCounts: {
      would_conflict: 0,
      would_exclude: 0,
      would_migrate: 0,
      would_quarantine: 2,
    },
    transformRegistryVersion: "test-transform-registry-v1",
  };
}

function migrationPreflight(): MigrationPreflightReport {
  return {
    canDryRun: true,
    canImport: true,
    dispositionRowsInMigrationScope: 2,
    dump: null,
    generatedAt: "2026-08-06T12:00:00.000Z",
    issues: [],
    manifestRowsInMigrationScope: 2,
    registryDirectory: "/registries",
    snapshotSha256,
    sourceSystem: "bitrix",
  };
}

type MysqlCallback = (error: NodeJS.ErrnoException | null, rows: unknown) => void;

class FakeMysqlConnection implements MysqlConnectionLike {
  public destroyed = false;
  public released = false;
  public readonly statements: string[] = [];
  readonly #rows = [
    { EMAIL: "private-one@example.invalid", ID: 1 },
    { EMAIL: "private-two@example.invalid", ID: 2 },
  ];

  public destroy(): void {
    this.destroyed = true;
  }

  public query(sql: string | Readonly<{ sql: string; timeout: number }>): MysqlQueryLike;
  public query(sql: string | Readonly<{ sql: string; timeout: number }>, callback: MysqlCallback): unknown;
  public query(
    input: string | Readonly<{ sql: string; timeout: number }>,
    callback?: MysqlCallback,
  ): MysqlQueryLike | unknown {
    const sql = typeof input === "string" ? input : input.sql;
    this.statements.push(sql);
    if (callback) {
      const rows = sql.includes("COUNT(*)")
        ? [{ source_rows: String(this.#rows.length) }]
        : sql.startsWith("SELECT 1")
          ? [{ ready: 1 }]
          : { affectedRows: 0 };
      queueMicrotask(() => callback(null, rows));
    }
    return {
      stream: () => Readable.from(this.#rows, { objectMode: true }),
    };
  }

  public release(): void {
    this.released = true;
  }
}

class FakeMysqlPool implements MysqlPoolLike {
  public ended = false;
  public readonly connection = new FakeMysqlConnection();

  public end(callback: (error: NodeJS.ErrnoException | null) => void): void {
    this.ended = true;
    callback(null);
  }

  public getConnection(
    callback: (error: NodeJS.ErrnoException | null, connection: MysqlConnectionLike) => void,
  ): void {
    callback(null, this.connection);
  }
}

interface StoredLedgerRow {
  readonly attempt: number;
  readonly ledger_key: string;
  readonly outcome: string;
  readonly reason_code: string;
  readonly recorded_at: Date;
  readonly run_id: string;
  readonly snapshot_sha256: string;
  readonly source_key_digest: string;
  readonly source_table: string;
  readonly transform_version: string;
}

class FakePgPool implements PgPoolLike {
  public ended = false;
  public readonly queryTexts: string[] = [];
  public readonly queryValues: unknown[][] = [];
  readonly #ledger = new Map<string, StoredLedgerRow>();

  public async end(): Promise<void> {
    this.ended = true;
  }

  public async query(sql: string, values: unknown[] = []): Promise<PgQueryResultLike> {
    this.queryTexts.push(sql);
    this.queryValues.push(values);
    if (sql.includes("WITH inserted_ledger AS")) {
      const ledgerKey = String(values[0]);
      let row = this.#ledger.get(ledgerKey);
      const wasInserted = row === undefined;
      if (!row) {
        row = {
          attempt: 1,
          ledger_key: ledgerKey,
          outcome: String(values[6]),
          reason_code: String(values[7]),
          recorded_at: new Date("2026-08-06T12:01:00.000Z"),
          run_id: String(values[1]),
          snapshot_sha256: String(values[2]),
          source_key_digest: String(values[4]),
          source_table: String(values[3]),
          transform_version: String(values[5]),
        };
        this.#ledger.set(ledgerKey, row);
      }
      return {
        rowCount: 1,
        rows: [
          {
            ...row,
            attempt_id: String(values[1]),
            conflicts_inserted: wasInserted ? "1" : "0",
            projection: String(values[8]),
            recorded_at: new Date("2026-08-06T12:01:00.000Z"),
            run_id: String(values[1]),
            runs_updated: "1",
            target_intents: (
              JSON.parse(String(values[9])) as Array<{
                projection: string;
                reason_code: string | null;
                target_action: string;
                target_id: string;
                target_type: string;
              }>
            ).map((target) => ({
              action: target.target_action,
              projection: target.projection,
              reasonCode: target.reason_code,
              targetEntity: target.target_type,
              targetId: target.target_id.length === 0 ? null : target.target_id,
            })),
            targets_inserted: "0",
            was_inserted: wasInserted,
          },
        ],
      };
    }
    return { rowCount: 1, rows: [] };
  }
}

describe("concrete migration adapters", () => {
  it("streams only an allowlisted MySQL SELECT inside read-only snapshots", async () => {
    const pool = new FakeMysqlPool();
    const source = new MysqlLegacySource({ pool, snapshotSha256 });
    const item = migrationPlan().items[0];
    if (!item) {
      throw new Error("test plan item is missing");
    }

    await expect(source.getIdentity()).resolves.toEqual({ sha256: snapshotSha256, sourceSystem: "bitrix" });
    await expect(source.countRows(item)).resolves.toBe(2);
    const rows = [];
    for await (const row of source.streamRows(item)) {
      rows.push(row);
    }

    expect(rows.map((row) => row.sourceKey)).toEqual([{ ID: 1 }, { ID: 2 }]);
    expect(pool.connection.statements).toContain("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
    expect(pool.connection.statements.filter((sql) => sql === "ROLLBACK")).toHaveLength(3);
    expect(pool.connection.statements.every((sql) => !/\b(?:UPDATE|DELETE|INSERT)\b/iu.test(sql))).toBe(true);
    await source.close();
    expect(pool.ended).toBe(true);
  });

  it("integrates streaming, safe classification, atomic ledger writes, and idempotent replay", async () => {
    const mysqlPool = new FakeMysqlPool();
    const pgPool = new FakePgPool();
    const source = new MysqlLegacySource({ pool: mysqlPool, snapshotSha256 });
    const unitOfWork = new PostgresMigrationUnitOfWork({ pool: pgPool });
    const common = {
      classifier: new SafeDryRunClassifier(),
      clock: () => new Date("2026-08-06T12:00:00.000Z"),
      mode: "dry-run" as const,
      plan: migrationPlan(),
      preflight: migrationPreflight(),
      source,
      unitOfWork,
    };

    const first = await executeMigration({ ...common, idFactory: () => runId });
    const second = await executeMigration({
      ...common,
      idFactory: () => "0190f1f2-3a4b-7c8d-9e0f-123456789abd",
    });

    expect(first.processedRows).toBe(2);
    expect(first.alreadyAppliedRows).toBe(0);
    expect(first.outcomeCounts.quarantined).toBe(2);
    expect(second.alreadyAppliedRows).toBe(2);
    expect(JSON.stringify(pgPool.queryValues)).not.toContain("private-one@example.invalid");
    expect(JSON.stringify(pgPool.queryValues)).not.toContain("private-two@example.invalid");
    expect(
      pgPool.queryTexts.every(
        (sql) => !/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:crm|identity|intake)\./iu.test(sql),
      ),
    ).toBe(true);
    await Promise.all([source.close(), unitOfWork.close()]);
  });

  it("rejects target payloads at the PostgreSQL dry-run boundary", async () => {
    const unitOfWork = new PostgresMigrationUnitOfWork({ pool: new FakePgPool() });
    const request: AtomicMigrationRequest = {
      decision: {
        outcome: "quarantined",
        reasonCode: "CANONICAL_TRANSFORM_NOT_IMPLEMENTED",
        projection: "would_quarantine",
        targetIntents: [],
        targetPayload: { email: "private@example.invalid" },
      },
      ledgerKey: "c".repeat(64),
      mode: "dry-run",
      row: { payload: { email: "private@example.invalid" }, sourceKey: { ID: 1 } },
      runId,
      snapshotSha256,
      sourceKeyDigest: "d".repeat(64),
      sourceTable: "b_crm_contact",
      transformVersion: "contact-v1",
    };

    await expect(unitOfWork.applyRowAtomically(request)).rejects.toMatchObject({
      code: "DRY_RUN_TARGET_MUTATION_FORBIDDEN",
    });
  });

  it("defines runtime privacy, idempotency, attempt history, and one-to-many target intents", async () => {
    const baseMigrationPath = fileURLToPath(
      new URL("../db/migrations/0003_migration_runtime.up.sql", import.meta.url),
    );
    const transformMigrationPath = fileURLToPath(
      new URL("../db/migrations/0070_migration_transform_runtime.up.sql", import.meta.url),
    );
    const [baseSql, transformSql] = await Promise.all([
      readFile(baseMigrationPath, "utf8"),
      readFile(transformMigrationPath, "utf8"),
    ]);

    expect(baseSql).toContain("migration_ledger_ledger_key_unique");
    expect(baseSql).toContain("migration_conflict_ledger_key_fk");
    expect(baseSql).toContain("enforce_runtime_metadata_only");
    expect(baseSql).toContain("source_key <> '{}'::jsonb");
    expect(transformSql).toContain("CREATE TABLE migration.ledger_attempt");
    expect(transformSql).toContain("CREATE TABLE migration.ledger_target");
    expect(transformSql).toContain("UNIQUE (run_id, ledger_key)");
    expect(transformSql).toContain("PRIMARY KEY (attempt_id, target_ordinal)");
    expect(transformSql).toContain("migration_ledger_attempt_append_only");
    expect(transformSql).toContain("migration_ledger_target_append_only");
  });
});
