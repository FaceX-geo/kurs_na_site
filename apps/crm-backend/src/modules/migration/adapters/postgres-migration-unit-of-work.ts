import { createHash } from "node:crypto";
import { Pool } from "pg";
import { MigrationError } from "../errors.js";
import type {
  AtomicMigrationRequest,
  AtomicMigrationResult,
  MigrationRunStart,
  MigrationUnitOfWorkPort,
} from "../ports.js";
import type {
  LedgerOutcome,
  MigrationLedgerRecord,
  MigrationProjection,
  MigrationRunSummary,
  MigrationTargetAction,
  MigrationTargetIntent,
} from "../types.js";
import { MIGRATION_PROJECTIONS, MIGRATION_TARGET_ACTIONS } from "../types.js";

export interface PgQueryResultLike {
  readonly rowCount: number | null;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
}

export interface PgPoolLike {
  end(): Promise<void>;
  query(sql: string, values?: unknown[]): Promise<PgQueryResultLike>;
}

export interface PostgresMigrationUnitOfWorkOptions {
  readonly databaseUrl?: string;
  readonly pool?: PgPoolLike;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const STABLE_CODE_PATTERN = /^[A-Z0-9_]{1,128}$/u;
const STABLE_IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;
const SOURCE_TABLE_PATTERN = /^[A-Za-z0-9_]{1,128}$/u;

const APPLY_DRY_RUN_ROW_SQL = `
WITH inserted_ledger AS (
  INSERT INTO migration.ledger (
    run_id,
    snapshot_sha256,
    source_table,
    source_key,
    source_key_hash,
    transform_version,
    outcome,
    target_type,
    target_id,
    reason_code,
    evidence,
    ledger_key,
    source_key_digest,
    attempt,
    recorded_at
  )
  VALUES (
    $2::uuid,
    $3,
    $4,
    '{}'::jsonb,
    $5,
    $6,
    $7,
    NULL,
    NULL,
    $8,
    '{}'::jsonb,
    $1,
    $5,
    1,
    clock_timestamp()
  )
  ON CONFLICT DO NOTHING
  RETURNING
    ledger_key,
    run_id,
    snapshot_sha256,
    source_table,
    source_key_digest,
    transform_version,
    outcome,
    reason_code,
    attempt,
    recorded_at
), inserted_conflict AS (
  INSERT INTO migration.conflict (
    run_id,
    conflict_type,
    source_table,
    source_key,
    severity,
    state,
    reason_code,
    evidence,
    ledger_key,
    source_key_digest
  )
  SELECT
    run_id,
    'dry_run_classification',
    source_table,
    '{}'::jsonb,
    'blocking',
    'open',
    reason_code,
    '{}'::jsonb,
    ledger_key,
    source_key_digest
  FROM inserted_ledger
  WHERE outcome = 'conflict_recorded'
     OR (outcome = 'quarantined' AND reason_code = 'SOURCE_TABLE_QUARANTINE_ONLY')
  ON CONFLICT (ledger_key) DO NOTHING
  RETURNING ledger_key
), resolved_ledger AS (
  SELECT
    ledger_key,
    run_id,
    snapshot_sha256,
    source_table,
    source_key_digest,
    transform_version,
    outcome,
    reason_code,
    attempt,
    recorded_at,
    TRUE AS was_inserted
  FROM inserted_ledger
  UNION ALL
  SELECT
    ledger_key,
    run_id,
    snapshot_sha256,
    source_table,
    source_key_digest,
    transform_version,
    outcome,
    reason_code,
    attempt,
    recorded_at,
    FALSE AS was_inserted
  FROM migration.ledger
  WHERE ledger_key = $1
    AND NOT EXISTS (SELECT 1 FROM inserted_ledger)
), inserted_attempt AS (
  INSERT INTO migration.ledger_attempt (
    run_id,
    ledger_key,
    snapshot_sha256,
    source_table,
    source_key_digest,
    transform_version,
    projection,
    outcome,
    reason_code,
    recorded_at
  )
  SELECT
    $2::uuid,
    ledger_key,
    snapshot_sha256,
    source_table,
    source_key_digest,
    transform_version,
    $9,
    outcome,
    reason_code,
    clock_timestamp()
  FROM resolved_ledger
  WHERE outcome = $7
    AND reason_code = $8
  ON CONFLICT (run_id, ledger_key) DO NOTHING
  RETURNING
    id,
    attempt_no,
    run_id,
    ledger_key,
    projection,
    outcome,
    reason_code,
    recorded_at
), resolved_attempt AS (
  SELECT * FROM inserted_attempt
  UNION ALL
  SELECT
    id,
    attempt_no,
    run_id,
    ledger_key,
    projection,
    outcome,
    reason_code,
    recorded_at
  FROM migration.ledger_attempt
  WHERE run_id = $2::uuid
    AND ledger_key = $1
    AND NOT EXISTS (SELECT 1 FROM inserted_attempt)
), requested_targets AS (
  SELECT *
  FROM jsonb_to_recordset($10::jsonb) AS target(
    target_ordinal integer,
    target_type text,
    target_id text,
    target_action text,
    projection text,
    reason_code text,
    target_key_digest text
  )
), inserted_targets AS (
  INSERT INTO migration.ledger_target (
    attempt_id,
    target_ordinal,
    target_type,
    target_id,
    target_action,
    projection,
    reason_code,
    target_key_digest,
    recorded_at
  )
  SELECT
    attempt.id,
    target.target_ordinal,
    target.target_type,
    NULLIF(target.target_id, '')::uuid,
    target.target_action,
    target.projection,
    target.reason_code,
    target.target_key_digest,
    clock_timestamp()
  FROM resolved_attempt AS attempt
  CROSS JOIN requested_targets AS target
  ON CONFLICT (attempt_id, target_ordinal) DO NOTHING
  RETURNING attempt_id
), updated_run AS (
  UPDATE migration.run
  SET processed_rows = processed_rows + 1,
      already_applied_rows = already_applied_rows +
        CASE WHEN EXISTS (SELECT 1 FROM inserted_ledger) THEN 0 ELSE 1 END
  WHERE id = $2::uuid
    AND state = 'dry_running'
    AND EXISTS (SELECT 1 FROM resolved_attempt)
  RETURNING id
)
SELECT
  ledger_key,
  (SELECT run_id::text FROM resolved_attempt) AS run_id,
  snapshot_sha256,
  source_table,
  source_key_digest,
  transform_version,
  outcome,
  reason_code,
  (SELECT attempt_no FROM resolved_attempt) AS attempt,
  (SELECT id::text FROM resolved_attempt) AS attempt_id,
  (SELECT projection FROM resolved_attempt) AS projection,
  (SELECT recorded_at FROM resolved_attempt) AS recorded_at,
  COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'action', target_action,
          'projection', projection,
          'reasonCode', reason_code,
          'targetEntity', target_type,
          'targetId', NULLIF(target_id, '')
        ) ORDER BY target_ordinal
      )
      FROM requested_targets
    ),
    '[]'::jsonb
  ) AS target_intents,
  was_inserted,
  (SELECT count(*) FROM inserted_conflict) AS conflicts_inserted,
  (SELECT count(*) FROM inserted_targets) AS targets_inserted,
  (SELECT count(*) FROM updated_run) AS runs_updated
FROM resolved_ledger
`;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new MigrationError("MIGRATION_ABORTED", "Migration was aborted safely");
  }
}

function assertDatabaseUrl(databaseUrl: string | undefined): asserts databaseUrl is string {
  if (!databaseUrl) {
    throw new MigrationError(
      "DATABASE_URL_REQUIRED",
      "DATABASE_URL is required for a real migration dry-run",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch (error) {
    throw new MigrationError("DATABASE_URL_INVALID", "DATABASE_URL is not a valid URL", { cause: error });
  }
  if (
    (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") ||
    parsed.hostname.length === 0
  ) {
    throw new MigrationError(
      "DATABASE_URL_INVALID",
      "DATABASE_URL must use the PostgreSQL protocol and identify a server",
    );
  }
}

function requireString(row: Readonly<Record<string, unknown>>, field: string): string {
  const value = row[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new MigrationError(
      "MIGRATION_LEDGER_RESULT_INVALID",
      "PostgreSQL migration ledger returned an invalid metadata row",
    );
  }
  return value;
}

function requireInteger(row: Readonly<Record<string, unknown>>, field: string): number {
  const value = row[field];
  const normalized = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new MigrationError(
      "MIGRATION_LEDGER_RESULT_INVALID",
      "PostgreSQL migration ledger returned invalid aggregate metadata",
    );
  }
  return normalized;
}

function requireBoolean(row: Readonly<Record<string, unknown>>, field: string): boolean {
  const value = row[field];
  if (typeof value !== "boolean") {
    throw new MigrationError(
      "MIGRATION_LEDGER_RESULT_INVALID",
      "PostgreSQL migration ledger returned invalid replay metadata",
    );
  }
  return value;
}

function requireIsoTimestamp(row: Readonly<Record<string, unknown>>, field: string): string {
  const value = row[field];
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value.toISOString();
  }
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  throw new MigrationError(
    "MIGRATION_LEDGER_RESULT_INVALID",
    "PostgreSQL migration ledger returned an invalid timestamp",
  );
}

function requireProjection(row: Readonly<Record<string, unknown>>, field: string): MigrationProjection {
  const value = requireString(row, field);
  if (!MIGRATION_PROJECTIONS.includes(value as MigrationProjection)) {
    throw new MigrationError(
      "MIGRATION_LEDGER_RESULT_INVALID",
      "PostgreSQL migration ledger returned an invalid projection",
    );
  }
  return value as MigrationProjection;
}

function parseTargetIntents(value: unknown): readonly MigrationTargetIntent[] {
  let decoded = value;
  if (typeof value === "string") {
    try {
      decoded = JSON.parse(value) as unknown;
    } catch (error) {
      throw new MigrationError(
        "MIGRATION_LEDGER_RESULT_INVALID",
        "PostgreSQL migration ledger returned invalid target intent JSON",
        { cause: error },
      );
    }
  }
  if (!Array.isArray(decoded)) {
    throw new MigrationError(
      "MIGRATION_LEDGER_RESULT_INVALID",
      "PostgreSQL migration ledger returned invalid target intents",
    );
  }

  return decoded.map((candidate): MigrationTargetIntent => {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      throw new MigrationError(
        "MIGRATION_LEDGER_RESULT_INVALID",
        "PostgreSQL migration ledger returned an invalid target intent",
      );
    }
    const row = candidate as Readonly<Record<string, unknown>>;
    const action = row.action;
    const projection = row.projection;
    const targetEntity = row.targetEntity;
    const targetId = row.targetId;
    const reasonCode = row.reasonCode;
    if (
      typeof action !== "string" ||
      !MIGRATION_TARGET_ACTIONS.includes(action as MigrationTargetAction) ||
      typeof projection !== "string" ||
      !MIGRATION_PROJECTIONS.includes(projection as MigrationProjection) ||
      typeof targetEntity !== "string" ||
      !STABLE_IDENTIFIER_PATTERN.test(targetEntity) ||
      (targetId !== null &&
        targetId !== undefined &&
        (typeof targetId !== "string" || !UUID_PATTERN.test(targetId))) ||
      (reasonCode !== null &&
        reasonCode !== undefined &&
        (typeof reasonCode !== "string" || !STABLE_CODE_PATTERN.test(reasonCode)))
    ) {
      throw new MigrationError(
        "MIGRATION_LEDGER_RESULT_INVALID",
        "PostgreSQL migration ledger returned invalid target intent metadata",
      );
    }
    return {
      action: action as MigrationTargetAction,
      projection: projection as MigrationProjection,
      ...(typeof reasonCode === "string" ? { reasonCode } : {}),
      targetEntity,
      ...(typeof targetId === "string" ? { targetId } : {}),
    };
  });
}

interface PersistedTargetIntent {
  readonly projection: MigrationProjection;
  readonly reason_code: string | null;
  readonly target_action: MigrationTargetAction;
  readonly target_id: string;
  readonly target_key_digest: string;
  readonly target_ordinal: number;
  readonly target_type: string;
}

function persistedTargetIntents(request: AtomicMigrationRequest): readonly PersistedTargetIntent[] {
  return request.decision.targetIntents.map((intent, targetOrdinal) => ({
    projection: intent.projection,
    reason_code: intent.reasonCode ?? null,
    target_action: intent.action,
    target_id: intent.targetId ?? "",
    target_key_digest: createHash("sha256")
      .update(
        `${request.ledgerKey}\u0000${String(targetOrdinal)}\u0000${intent.targetEntity}\u0000${intent.action}`,
      )
      .digest("hex"),
    target_ordinal: targetOrdinal,
    target_type: intent.targetEntity,
  }));
}

function assertDryRunRequest(request: AtomicMigrationRequest): void {
  if (request.mode !== "dry-run") {
    throw new MigrationError(
      "IMPORT_CANONICAL_TRANSFORMS_REQUIRED",
      "Import remains disabled until every source table has a canonical transactional transform",
    );
  }
  if (
    request.decision.outcome === "migrated" ||
    request.decision.outcome === "linked_existing" ||
    request.decision.targetEntity !== undefined ||
    request.decision.targetId !== undefined ||
    request.decision.targetPayload !== undefined
  ) {
    throw new MigrationError(
      "DRY_RUN_TARGET_MUTATION_FORBIDDEN",
      "Dry-run decisions cannot contain a canonical target mutation",
    );
  }
  if (
    !UUID_PATTERN.test(request.runId) ||
    !SHA256_PATTERN.test(request.ledgerKey) ||
    !SHA256_PATTERN.test(request.snapshotSha256) ||
    !SHA256_PATTERN.test(request.sourceKeyDigest) ||
    !SOURCE_TABLE_PATTERN.test(request.sourceTable) ||
    !STABLE_IDENTIFIER_PATTERN.test(request.transformVersion) ||
    request.decision.reasonCode === undefined ||
    !STABLE_CODE_PATTERN.test(request.decision.reasonCode)
  ) {
    throw new MigrationError(
      "MIGRATION_LEDGER_METADATA_INVALID",
      "Dry-run ledger metadata does not satisfy the privacy-safe runtime contract",
    );
  }
  if (
    !MIGRATION_PROJECTIONS.includes(request.decision.projection) ||
    request.decision.targetIntents.some(
      (intent) =>
        !MIGRATION_TARGET_ACTIONS.includes(intent.action) ||
        !MIGRATION_PROJECTIONS.includes(intent.projection) ||
        !STABLE_IDENTIFIER_PATTERN.test(intent.targetEntity) ||
        (intent.targetId !== undefined && !UUID_PATTERN.test(intent.targetId)) ||
        (intent.reasonCode !== undefined && !STABLE_CODE_PATTERN.test(intent.reasonCode)),
    )
  ) {
    throw new MigrationError(
      "MIGRATION_LEDGER_METADATA_INVALID",
      "Dry-run target intent metadata does not satisfy the privacy-safe runtime contract",
    );
  }
}

function ledgerRecordFromRow(row: Readonly<Record<string, unknown>>): MigrationLedgerRecord {
  const outcome = requireString(row, "outcome") as LedgerOutcome;
  const reasonCode = row.reason_code;
  if (typeof reasonCode !== "string" || !STABLE_CODE_PATTERN.test(reasonCode)) {
    throw new MigrationError(
      "MIGRATION_LEDGER_RESULT_INVALID",
      "PostgreSQL migration ledger returned an invalid reason code",
    );
  }
  return {
    attempt: requireInteger(row, "attempt"),
    attemptId: requireString(row, "attempt_id"),
    decision: {
      outcome,
      projection: requireProjection(row, "projection"),
      reasonCode,
      targetIntents: parseTargetIntents(row.target_intents),
    },
    ledgerKey: requireString(row, "ledger_key"),
    recordedAt: requireIsoTimestamp(row, "recorded_at"),
    runId: requireString(row, "run_id"),
    snapshotSha256: requireString(row, "snapshot_sha256"),
    sourceKeyDigest: requireString(row, "source_key_digest"),
    sourceTable: requireString(row, "source_table"),
    transformVersion: requireString(row, "transform_version"),
  };
}

function targetIntentMismatchField(
  left: readonly MigrationTargetIntent[],
  right: readonly MigrationTargetIntent[],
): string | undefined {
  if (left.length !== right.length) {
    return "length";
  }
  for (const [index, intent] of left.entries()) {
    const candidate = right[index];
    if (candidate === undefined) {
      return `${String(index)}.missing`;
    }
    for (const field of ["action", "projection", "reasonCode", "targetEntity", "targetId"] as const) {
      if (intent[field] !== candidate[field]) {
        return `${String(index)}.${field}`;
      }
    }
  }
  return undefined;
}

function replayMismatchField(
  record: MigrationLedgerRecord,
  request: AtomicMigrationRequest,
): string | undefined {
  const checks: ReadonlyArray<readonly [boolean, string]> = [
    [record.ledgerKey === request.ledgerKey, "ledger_key"],
    [record.snapshotSha256 === request.snapshotSha256, "snapshot_sha256"],
    [record.sourceKeyDigest === request.sourceKeyDigest, "source_key_digest"],
    [record.sourceTable === request.sourceTable, "source_table"],
    [record.transformVersion === request.transformVersion, "transform_version"],
    [record.decision.outcome === request.decision.outcome, "outcome"],
    [record.decision.projection === request.decision.projection, "projection"],
    [record.decision.reasonCode === request.decision.reasonCode, "reason_code"],
    [record.runId === request.runId, "run_id"],
    [
      targetIntentMismatchField(record.decision.targetIntents, request.decision.targetIntents) === undefined,
      `target_intents.${targetIntentMismatchField(
        record.decision.targetIntents,
        request.decision.targetIntents,
      )}`,
    ],
  ];
  return checks.find(([matches]) => !matches)?.[1];
}

function assertUpdated(result: PgQueryResultLike, code: string, message: string): void {
  if (result.rowCount !== 1) {
    throw new MigrationError(code, message);
  }
}

export class PostgresMigrationUnitOfWork implements MigrationUnitOfWorkPort {
  readonly #pool: PgPoolLike;

  public constructor(options: PostgresMigrationUnitOfWorkOptions) {
    if (options.pool === undefined) {
      assertDatabaseUrl(options.databaseUrl);
    }
    this.#pool =
      options.pool ??
      (new Pool({
        application_name: "kurs-crm-migration-dry-run",
        connectionString: options.databaseUrl,
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 30_000,
        max: 10,
      }) as unknown as PgPoolLike);
  }

  public async applyRowAtomically(
    request: AtomicMigrationRequest,
    signal?: AbortSignal,
  ): Promise<AtomicMigrationResult> {
    throwIfAborted(signal);
    assertDryRunRequest(request);
    let result: PgQueryResultLike;
    try {
      result = await this.#pool.query(APPLY_DRY_RUN_ROW_SQL, [
        request.ledgerKey,
        request.runId,
        request.snapshotSha256,
        request.sourceTable,
        request.sourceKeyDigest,
        request.transformVersion,
        request.decision.outcome,
        request.decision.reasonCode,
        request.decision.projection,
        JSON.stringify(persistedTargetIntents(request)),
      ]);
    } catch (error) {
      throw new MigrationError(
        "MIGRATION_LEDGER_WRITE_FAILED",
        "PostgreSQL could not atomically record the dry-run ledger outcome",
        { cause: error },
      );
    }

    const row = result.rows[0];
    if (result.rowCount !== 1 || row === undefined) {
      throw new MigrationError(
        "MIGRATION_LEDGER_REPLAY_UNRESOLVED",
        "PostgreSQL could not resolve an inserted or replayed ledger outcome",
      );
    }
    const record = ledgerRecordFromRow(row);
    if (requireInteger(row, "runs_updated") !== 1) {
      throw new MigrationError(
        "MIGRATION_RUN_PROGRESS_FAILED",
        "PostgreSQL did not atomically update the active migration run",
      );
    }
    const mismatchField = replayMismatchField(record, request);
    if (mismatchField !== undefined) {
      throw new MigrationError(
        "MIGRATION_LEDGER_REPLAY_MISMATCH",
        `An idempotent ledger replay resolved to different immutable metadata: ${mismatchField}`,
      );
    }

    return {
      record,
      status: requireBoolean(row, "was_inserted") ? "recorded" : "already-applied",
    };
  }

  public async beginRun(run: MigrationRunStart, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    if (run.mode !== "dry-run") {
      throw new MigrationError(
        "IMPORT_CANONICAL_TRANSFORMS_REQUIRED",
        "Import remains disabled until every source table has a canonical transactional transform",
      );
    }
    if (
      !UUID_PATTERN.test(run.runId) ||
      !SHA256_PATTERN.test(run.snapshotSha256) ||
      !STABLE_IDENTIFIER_PATTERN.test(run.adapterName) ||
      !STABLE_IDENTIFIER_PATTERN.test(run.manifestVersion) ||
      !STABLE_IDENTIFIER_PATTERN.test(run.transformRegistryVersion) ||
      run.blockerCodes.some((code) => !STABLE_CODE_PATTERN.test(code)) ||
      !Number.isSafeInteger(run.expectedRows) ||
      run.expectedRows < 0 ||
      Number.isNaN(Date.parse(run.startedAt))
    ) {
      throw new MigrationError(
        "MIGRATION_RUN_METADATA_INVALID",
        "Migration run metadata does not satisfy the runtime contract",
      );
    }

    try {
      const result = await this.#pool.query(
        `INSERT INTO migration.run (
          id,
          public_id,
          source_system,
          snapshot_sha256,
          manifest_version,
          transform_version,
          state,
          started_at,
          counts,
          blockers,
          mode,
          adapter_name,
          expected_rows,
          processed_rows,
          already_applied_rows,
          outcome_counts
        ) VALUES (
          $1::uuid,
          $2,
          $3,
          $4,
          $5,
          $10,
          'dry_running',
          $6::timestamptz,
          jsonb_build_object('expectedRows', $7::bigint),
          $9::jsonb,
          'dry-run',
          $8,
          $7::bigint,
          0,
          0,
          '{}'::jsonb
        )`,
        [
          run.runId,
          `migration-${run.runId}`,
          run.sourceSystem,
          run.snapshotSha256,
          run.manifestVersion,
          run.startedAt,
          run.expectedRows,
          run.adapterName,
          JSON.stringify(run.blockerCodes),
          run.transformRegistryVersion,
        ],
      );
      assertUpdated(result, "MIGRATION_RUN_START_FAILED", "PostgreSQL did not create the migration run");
    } catch (error) {
      if (error instanceof MigrationError) {
        throw error;
      }
      throw new MigrationError(
        "MIGRATION_RUN_START_FAILED",
        "PostgreSQL could not create the migration run",
        { cause: error },
      );
    }
  }

  public async close(): Promise<void> {
    await this.#pool.end();
  }

  public async completeRun(summary: MigrationRunSummary, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    const counts = JSON.stringify(summary.outcomeCounts);
    const projectionCounts = JSON.stringify(summary.projectionCounts);
    const targetProjectionCounts = JSON.stringify(summary.targetProjectionCounts);
    try {
      const result = await this.#pool.query(
        `UPDATE migration.run
         SET state = 'completed',
             finished_at = $2::timestamptz,
             processed_rows = $3::bigint,
             already_applied_rows = $4::bigint,
             outcome_counts = $5::jsonb,
             counts = jsonb_build_object(
               'expectedRows', expected_rows,
               'processedRows', $3::bigint,
               'alreadyAppliedRows', $4::bigint,
               'outcomeCounts', $5::jsonb,
               'projectionCounts', $6::jsonb,
               'targetProjectionCounts', $7::jsonb
             ),
             failure_code = NULL
         WHERE id = $1::uuid
           AND state = 'dry_running'`,
        [
          summary.runId,
          summary.completedAt,
          summary.processedRows,
          summary.alreadyAppliedRows,
          counts,
          projectionCounts,
          targetProjectionCounts,
        ],
      );
      assertUpdated(
        result,
        "MIGRATION_RUN_COMPLETE_FAILED",
        "PostgreSQL did not complete exactly one active migration run",
      );
    } catch (error) {
      if (error instanceof MigrationError) {
        throw error;
      }
      throw new MigrationError(
        "MIGRATION_RUN_COMPLETE_FAILED",
        "PostgreSQL could not complete the migration run",
        { cause: error },
      );
    }
  }

  public async failRun(runId: string, reasonCode: string, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    if (!UUID_PATTERN.test(runId) || !STABLE_CODE_PATTERN.test(reasonCode)) {
      throw new MigrationError(
        "MIGRATION_RUN_FAILURE_METADATA_INVALID",
        "Migration failure metadata is invalid",
      );
    }
    try {
      const result = await this.#pool.query(
        `UPDATE migration.run
         SET state = 'failed',
             finished_at = clock_timestamp(),
             failure_code = $2::text,
             blockers = jsonb_build_array(jsonb_build_object('code', $2::text))
         WHERE id = $1::uuid
           AND state = 'dry_running'`,
        [runId, reasonCode],
      );
      assertUpdated(
        result,
        "MIGRATION_RUN_FAIL_FAILED",
        "PostgreSQL did not fail exactly one active migration run",
      );
    } catch (error) {
      if (error instanceof MigrationError) {
        throw error;
      }
      throw new MigrationError(
        "MIGRATION_RUN_FAIL_FAILED",
        "PostgreSQL could not record the migration failure",
        { cause: error },
      );
    }
  }
}
