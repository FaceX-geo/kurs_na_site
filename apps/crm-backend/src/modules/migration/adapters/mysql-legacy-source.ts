import type { Readable } from "node:stream";
import { createPool } from "mysql2";
import { MigrationError } from "../errors.js";
import type { LegacySourceIdentity, LegacySourcePort } from "../ports.js";
import type { LegacyRowEnvelope, LegacySourceKeyValue, MigrationPlanItem } from "../types.js";
import { EXPECTED_SOURCE_SYSTEM } from "../types.js";

type MysqlSqlInput = string | Readonly<{ sql: string; timeout: number }>;

export interface MysqlQueryLike {
  stream(options?: Readonly<{ highWaterMark?: number }>): Readable;
}

export interface MysqlConnectionLike {
  destroy(): void;
  query(sql: MysqlSqlInput): MysqlQueryLike;
  query(sql: MysqlSqlInput, callback: (error: NodeJS.ErrnoException | null, rows: unknown) => void): unknown;
  release(): void;
}

export interface MysqlPoolLike {
  end(callback: (error: NodeJS.ErrnoException | null) => void): void;
  getConnection(
    callback: (error: NodeJS.ErrnoException | null, connection: MysqlConnectionLike) => void,
  ): void;
}

export interface MysqlLegacySourceOptions {
  readonly connectionUrl?: string;
  readonly highWaterMark?: number;
  readonly pool?: MysqlPoolLike;
  readonly queryTimeoutMs?: number;
  readonly snapshotSha256: string;
  readonly sourceSystem?: string;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SOURCE_TABLE_PATTERN = /^[A-Za-z0-9_]+$/u;
const UNSAFE_SQL_PATTERN =
  /(?:;|--|#|\/\*|\b(?:INSERT|UPDATE|DELETE|UPSERT|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE|CALL|DO|HANDLER|LOAD)\b|\bREPLACE\b(?!\s*\()|\bINTO\s+(?:OUTFILE|DUMPFILE)\b|\bFOR\s+UPDATE\b|\bLOCK\s+IN\s+SHARE\s+MODE\b|\b(?:SLEEP|BENCHMARK|LOAD_FILE)\s*\()/iu;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new MigrationError("MIGRATION_ABORTED", "Migration was aborted safely");
  }
}

function assertConnectionUrl(connectionUrl: string | undefined): asserts connectionUrl is string {
  if (!connectionUrl) {
    throw new MigrationError(
      "LEGACY_MYSQL_URL_REQUIRED",
      "LEGACY_MYSQL_URL is required for a real read-only migration run",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(connectionUrl);
  } catch (error) {
    throw new MigrationError("LEGACY_MYSQL_URL_INVALID", "LEGACY_MYSQL_URL is not a valid URL", {
      cause: error,
    });
  }

  if ((parsed.protocol !== "mysql:" && parsed.protocol !== "mysql2:") || parsed.hostname.length === 0) {
    throw new MigrationError(
      "LEGACY_MYSQL_URL_INVALID",
      "LEGACY_MYSQL_URL must use the mysql protocol and identify a server",
    );
  }
}

function assertAllowlistedSql(item: MigrationPlanItem): void {
  if (!SOURCE_TABLE_PATTERN.test(item.sourceTable)) {
    throw new MigrationError(
      "SOURCE_QUERY_NOT_ALLOWLISTED",
      "Migration source table identifier is not allowlisted",
    );
  }

  const expectedCountSql = `SELECT COUNT(*) AS source_rows FROM \`${item.sourceTable}\``;
  if (item.countSql.trim() !== expectedCountSql) {
    throw new MigrationError(
      "SOURCE_QUERY_NOT_ALLOWLISTED",
      `Count query is not the authoritative read-only form for table ${item.sourceTable}`,
    );
  }

  const extractionSql = item.extractionSql.trim();
  const sourceTableExpression = new RegExp(`\\bFROM\\s+\`${item.sourceTable}\``, "iu");
  if (
    !/^SELECT\s/iu.test(extractionSql) ||
    !sourceTableExpression.test(extractionSql) ||
    UNSAFE_SQL_PATTERN.test(extractionSql)
  ) {
    throw new MigrationError(
      "SOURCE_QUERY_NOT_ALLOWLISTED",
      `Extraction query is not an allowlisted read-only SELECT for table ${item.sourceTable}`,
    );
  }
}

function asRecord(value: unknown, sourceTable: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new MigrationError(
      "LEGACY_SOURCE_ROW_INVALID",
      `Legacy source returned a non-object row for table ${sourceTable}`,
    );
  }
  return value as Readonly<Record<string, unknown>>;
}

function asSourceKeyValue(value: unknown, sourceTable: string, sourceColumn: string): LegacySourceKeyValue {
  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return value;
  }

  throw new MigrationError(
    "SOURCE_KEY_CONTRACT_VIOLATION",
    `Legacy source returned an unsupported key value for ${sourceTable}.${sourceColumn}`,
  );
}

function parseCountRows(rows: unknown, sourceTable: string): number {
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new MigrationError(
      "LEGACY_SOURCE_COUNT_INVALID",
      `Legacy source returned an invalid count result for table ${sourceTable}`,
    );
  }
  const count = asRecord(rows[0], sourceTable).source_rows;
  const normalized = typeof count === "number" ? String(count) : count;
  if (typeof normalized !== "string" || !/^(0|[1-9]\d*)$/u.test(normalized)) {
    throw new MigrationError(
      "LEGACY_SOURCE_COUNT_INVALID",
      `Legacy source returned an invalid row count for table ${sourceTable}`,
    );
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    throw new MigrationError(
      "LEGACY_SOURCE_COUNT_INVALID",
      `Legacy source count exceeds the safe integer range for table ${sourceTable}`,
    );
  }
  return parsed;
}

function acquireConnection(pool: MysqlPoolLike): Promise<MysqlConnectionLike> {
  return new Promise((resolve, reject) => {
    pool.getConnection((error, connection) => {
      if (error) {
        reject(error);
      } else {
        resolve(connection);
      }
    });
  });
}

function queryRows(connection: MysqlConnectionLike, sql: MysqlSqlInput): Promise<unknown> {
  return new Promise((resolve, reject) => {
    connection.query(sql, (error, rows) => {
      if (error) {
        reject(error);
      } else {
        resolve(rows);
      }
    });
  });
}

async function startReadOnlySnapshot(connection: MysqlConnectionLike): Promise<void> {
  await queryRows(connection, "SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ");
  await queryRows(connection, "START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
}

async function releaseReadOnlySnapshot(connection: MysqlConnectionLike): Promise<void> {
  try {
    await queryRows(connection, "ROLLBACK");
    connection.release();
  } catch {
    connection.destroy();
  }
}

export class MysqlLegacySource implements LegacySourcePort {
  public readonly adapterName = "mysql2-read-only-stream-v1";
  readonly #highWaterMark: number;
  readonly #pool: MysqlPoolLike;
  readonly #queryTimeoutMs: number;
  readonly #snapshotSha256: string;
  readonly #sourceSystem: string;

  public constructor(options: MysqlLegacySourceOptions) {
    if (!SHA256_PATTERN.test(options.snapshotSha256)) {
      throw new MigrationError(
        "SOURCE_ADAPTER_IDENTITY_INVALID",
        "Legacy source adapter requires a lowercase SHA-256 snapshot identity",
      );
    }
    if ((options.sourceSystem ?? EXPECTED_SOURCE_SYSTEM) !== EXPECTED_SOURCE_SYSTEM) {
      throw new MigrationError(
        "SOURCE_ADAPTER_IDENTITY_INVALID",
        `Legacy source adapter only supports source_system=${EXPECTED_SOURCE_SYSTEM}`,
      );
    }
    this.#snapshotSha256 = options.snapshotSha256;
    this.#sourceSystem = options.sourceSystem ?? EXPECTED_SOURCE_SYSTEM;
    this.#queryTimeoutMs = options.queryTimeoutMs ?? 120_000;
    this.#highWaterMark = options.highWaterMark ?? 100;
    if (!Number.isSafeInteger(this.#queryTimeoutMs) || this.#queryTimeoutMs < 1_000) {
      throw new MigrationError("SOURCE_ADAPTER_CONFIG_INVALID", "MySQL query timeout is invalid");
    }
    if (!Number.isSafeInteger(this.#highWaterMark) || this.#highWaterMark < 1) {
      throw new MigrationError("SOURCE_ADAPTER_CONFIG_INVALID", "MySQL stream high-water mark is invalid");
    }

    if (options.pool !== undefined) {
      this.#pool = options.pool;
    } else {
      const connectionUrl = options.connectionUrl;
      assertConnectionUrl(connectionUrl);
      this.#pool = createPool({
        bigNumberStrings: true,
        connectionLimit: 2,
        connectTimeout: 10_000,
        dateStrings: true,
        decimalNumbers: false,
        enableKeepAlive: true,
        keepAliveInitialDelay: 0,
        maxIdle: 2,
        multipleStatements: false,
        queueLimit: 0,
        resetOnRelease: true,
        rowsAsArray: false,
        supportBigNumbers: true,
        timezone: "Z",
        uri: connectionUrl,
        waitForConnections: true,
      }) as unknown as MysqlPoolLike;
    }
  }

  public async close(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.#pool.end((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  public async countRows(item: MigrationPlanItem, signal?: AbortSignal): Promise<number> {
    throwIfAborted(signal);
    assertAllowlistedSql(item);
    const connection = await acquireConnection(this.#pool).catch((error: unknown) => {
      throw new MigrationError(
        "LEGACY_SOURCE_CONNECTION_FAILED",
        "Could not acquire a read-only legacy source connection",
        { cause: error },
      );
    });

    let transactionStarted = false;
    try {
      await startReadOnlySnapshot(connection);
      transactionStarted = true;
      throwIfAborted(signal);
      const rows = await queryRows(connection, {
        sql: item.countSql,
        timeout: this.#queryTimeoutMs,
      });
      return parseCountRows(rows, item.sourceTable);
    } catch (error) {
      if (error instanceof MigrationError) {
        throw error;
      }
      throw new MigrationError(
        "LEGACY_SOURCE_COUNT_FAILED",
        `Read-only source count failed for table ${item.sourceTable}`,
        { cause: error },
      );
    } finally {
      if (transactionStarted) {
        await releaseReadOnlySnapshot(connection);
      } else {
        connection.destroy();
      }
    }
  }

  public async getIdentity(signal?: AbortSignal): Promise<LegacySourceIdentity> {
    throwIfAborted(signal);
    const connection = await acquireConnection(this.#pool).catch((error: unknown) => {
      throw new MigrationError(
        "LEGACY_SOURCE_CONNECTION_FAILED",
        "Could not acquire a read-only legacy source connection",
        { cause: error },
      );
    });

    let transactionStarted = false;
    try {
      await startReadOnlySnapshot(connection);
      transactionStarted = true;
      throwIfAborted(signal);
      await queryRows(connection, { sql: "SELECT 1 AS ready", timeout: this.#queryTimeoutMs });
      return { sha256: this.#snapshotSha256, sourceSystem: this.#sourceSystem };
    } catch (error) {
      if (error instanceof MigrationError) {
        throw error;
      }
      throw new MigrationError(
        "LEGACY_SOURCE_IDENTITY_CHECK_FAILED",
        "Could not validate the read-only legacy source session",
        { cause: error },
      );
    } finally {
      if (transactionStarted) {
        await releaseReadOnlySnapshot(connection);
      } else {
        connection.destroy();
      }
    }
  }

  public async *streamRows(item: MigrationPlanItem, signal?: AbortSignal): AsyncIterable<LegacyRowEnvelope> {
    throwIfAborted(signal);
    assertAllowlistedSql(item);
    const connection = await acquireConnection(this.#pool).catch((error: unknown) => {
      throw new MigrationError(
        "LEGACY_SOURCE_CONNECTION_FAILED",
        "Could not acquire a read-only legacy source connection",
        { cause: error },
      );
    });
    let completed = false;
    let transactionStarted = false;
    let stream: Readable | undefined;
    const abortListener = (): void => {
      stream?.destroy(new MigrationError("MIGRATION_ABORTED", "Migration was aborted safely"));
    };

    try {
      await startReadOnlySnapshot(connection);
      transactionStarted = true;
      throwIfAborted(signal);
      stream = connection
        .query({ sql: item.extractionSql, timeout: this.#queryTimeoutMs })
        .stream({ highWaterMark: this.#highWaterMark });
      signal?.addEventListener("abort", abortListener, { once: true });

      for await (const value of stream) {
        throwIfAborted(signal);
        const payload = asRecord(value, item.sourceTable);
        const sourceKey: Record<string, LegacySourceKeyValue> = {};
        for (const column of item.sourceKey.columns) {
          sourceKey[column] = asSourceKeyValue(payload[column], item.sourceTable, column);
        }
        yield { payload, sourceKey };
      }
      completed = true;
    } catch (error) {
      if (error instanceof MigrationError) {
        throw error;
      }
      throw new MigrationError(
        "LEGACY_SOURCE_STREAM_FAILED",
        `Read-only source stream failed for table ${item.sourceTable}`,
        { cause: error },
      );
    } finally {
      signal?.removeEventListener("abort", abortListener);
      if (transactionStarted && completed) {
        await releaseReadOnlySnapshot(connection);
      } else {
        stream?.destroy();
        connection.destroy();
      }
    }
  }
}
