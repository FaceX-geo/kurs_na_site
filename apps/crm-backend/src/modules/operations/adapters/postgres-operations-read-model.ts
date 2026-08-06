import { type Kysely, type RawBuilder, sql } from "kysely";
import { AppError } from "../../../common/errors.js";
import type { CursorValue } from "../../../common/pagination.js";
import type { Database } from "../../../db/types.js";
import type { AuditEvent, MigrationConflict, MigrationRun } from "../contracts.js";
import type {
  AuditEventRepositoryQuery,
  MetricsSnapshot,
  MigrationConflictRepositoryQuery,
  MigrationRunRepositoryQuery,
  OperationsAccessScope,
  OperationsReadRepositoryPort,
  OperationsRepositoryPage,
} from "../ports.js";
import {
  nonNegativeInteger,
  redactAuditReason,
  redactBlockerCodes,
  redactPolicyVersion,
} from "../redaction.js";

interface MigrationRunRow {
  id: string;
  public_id: string;
  source_system: string;
  snapshot_sha256: string;
  manifest_version: string;
  transform_version: string;
  state: string;
  mode: string | null;
  started_at: Date | string;
  finished_at: Date | string | null;
  expected_rows: number | string;
  processed_rows: number | string;
  already_applied_rows: number | string;
  outcome_counts: unknown;
  blockers: unknown;
}

interface MigrationConflictRow {
  id: string;
  run_public_id: string;
  conflict_type: string;
  source_table: string;
  source_key_digest: string | null;
  severity: string;
  state: string;
  reason_code: string;
  resolution_present: boolean;
  version: number | string;
  created_at: Date | string;
  updated_at: Date | string;
  resolved_at: Date | string | null;
}

interface AuditEventRow {
  id: string;
  event_type: string;
  actor_type: string;
  actor_in_own_scope: boolean;
  subject_type: string;
  subject_present: boolean;
  request_id: string | null;
  reason_code: string | null;
  policy_version: string | null;
  has_before_state: boolean;
  has_after_state: boolean;
  occurred_at: Date | string;
  event_hash: string;
  previous_hash_present: boolean;
}

const RUN_STATES = new Set([
  "created",
  "profiling",
  "dry_running",
  "awaiting_conflicts",
  "ready_for_rehearsal",
  "rehearsing",
  "ready_for_cutover",
  "cutting_over",
  "completed",
  "failed",
  "rolled_back",
  "cancelled",
]);
const CONFLICT_STATES = new Set(["open", "assigned", "resolved", "rejected", "waived", "superseded"]);
const MACHINE_IDENTIFIER = /^[A-Za-z0-9_.:-]{1,128}$/;
const SOURCE_TABLE = /^[A-Za-z0-9_]+$/;

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}

function valuesSql(values: readonly string[]): RawBuilder<unknown> {
  return sql.join(values.map((value) => sql`${value}::uuid`));
}

function runScopeSql(scope: OperationsAccessScope, alias = "run"): RawBuilder<boolean> {
  if (scope.visibility === "all") {
    return sql<boolean>`true`;
  }
  if (scope.resourceIds.length === 0) {
    return sql<boolean>`false`;
  }
  return sql<boolean>`${sql.ref(`${alias}.id`)} in (${valuesSql(scope.resourceIds)})`;
}

function auditScopeSql(scope: OperationsAccessScope, alias = "event"): RawBuilder<boolean> {
  if (scope.visibility === "all") {
    return sql<boolean>`true`;
  }
  const predicates: RawBuilder<boolean>[] = [];
  if (scope.visibility === "self" || scope.includeActorEvents) {
    predicates.push(sql<boolean>`${sql.ref(`${alias}.actor_id`)} = ${scope.actorUserAccountId}::uuid`);
  }
  if (scope.resourceIds.length > 0) {
    predicates.push(sql<boolean>`${sql.ref(`${alias}.subject_id`)} in (${valuesSql(scope.resourceIds)})`);
  }
  return predicates.length > 0 ? sql<boolean>`(${sql.join(predicates, sql` or `)})` : sql<boolean>`false`;
}

function cursorSql(timestampColumn: string, idColumn: string, cursor: CursorValue): RawBuilder<boolean> {
  return sql<boolean>`(
    ${sql.ref(timestampColumn)}, ${sql.ref(idColumn)}
  ) < (${new Date(cursor.createdAt)}, ${cursor.id}::uuid)`;
}

function stableIdentifier(value: string, fallback: string): string {
  return MACHINE_IDENTIFIER.test(value) ? value : fallback;
}

function outcomeCounts(value: unknown): MigrationRun["outcomeCounts"] {
  const record =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Readonly<Record<string, unknown>>)
      : {};
  return {
    migrated: nonNegativeInteger(record.migrated),
    linkedExisting: nonNegativeInteger(record.linked_existing),
    excludedWithReason: nonNegativeInteger(record.excluded_with_reason),
    conflictRecorded: nonNegativeInteger(record.conflict_recorded),
    quarantined: nonNegativeInteger(record.quarantined),
  };
}

function mapRun(row: MigrationRunRow): MigrationRun {
  const state = RUN_STATES.has(row.state) ? row.state : "failed";
  const mode = row.mode === "dry-run" || row.mode === "import" ? row.mode : null;
  return {
    publicId: row.public_id,
    sourceSystem: "bitrix",
    snapshotSha256: row.snapshot_sha256,
    manifestVersion: row.manifest_version,
    transformVersion: row.transform_version,
    state: state as MigrationRun["state"],
    mode,
    startedAt: toIso(row.started_at),
    finishedAt: nullableIso(row.finished_at),
    expectedRows: nonNegativeInteger(row.expected_rows),
    processedRows: nonNegativeInteger(row.processed_rows),
    alreadyAppliedRows: nonNegativeInteger(row.already_applied_rows),
    outcomeCounts: outcomeCounts(row.outcome_counts),
    blockerCodes: redactBlockerCodes(row.blockers),
  };
}

function mapConflict(row: MigrationConflictRow): MigrationConflict {
  const state = CONFLICT_STATES.has(row.state) ? row.state : "open";
  return {
    id: row.id,
    runId: row.run_public_id,
    conflictType: stableIdentifier(row.conflict_type, "UNCLASSIFIED"),
    sourceTable: SOURCE_TABLE.test(row.source_table) ? row.source_table : "unknown_table",
    sourceKeyDigest: /^[a-f0-9]{64}$/.test(row.source_key_digest ?? "") ? row.source_key_digest : null,
    severity: row.severity === "warning" ? "warning" : "blocking",
    state: state as MigrationConflict["state"],
    reasonCode: redactAuditReason(row.reason_code) ?? "UNCLASSIFIED",
    resolutionPresent: row.resolution_present,
    version: Math.max(1, nonNegativeInteger(row.version)),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    resolvedAt: nullableIso(row.resolved_at),
  };
}

function mapAuditEvent(row: AuditEventRow): AuditEvent {
  return {
    id: row.id,
    eventType: stableIdentifier(row.event_type, "unclassified"),
    occurredAt: toIso(row.occurred_at),
    actorType: stableIdentifier(row.actor_type, "unknown"),
    actorInOwnScope: row.actor_in_own_scope,
    subjectType: stableIdentifier(row.subject_type, "unknown"),
    subjectPresent: row.subject_present,
    requestId: row.request_id,
    reasonCode: redactAuditReason(row.reason_code),
    policyVersion: redactPolicyVersion(row.policy_version),
    hasBeforeState: row.has_before_state,
    hasAfterState: row.has_after_state,
    eventHash: row.event_hash,
    previousHashPresent: row.previous_hash_present,
  };
}

function pageFromRows<Row extends { id: string }, Result>(
  rows: readonly Row[],
  limit: number,
  timestamp: (row: Row) => Date | string,
  map: (row: Row) => Result,
): OperationsRepositoryPage<Result> {
  const hasMore = rows.length > limit;
  const selected = rows.slice(0, limit);
  const last = selected.at(-1);
  return {
    items: selected.map(map),
    hasMore,
    nextCursor: hasMore && last ? { createdAt: toIso(timestamp(last)), id: last.id } : null,
  };
}

export class PostgresOperationsReadModel implements OperationsReadRepositoryPort {
  constructor(private readonly db: Kysely<Database>) {}

  async listMigrationRuns(
    scope: OperationsAccessScope,
    query: MigrationRunRepositoryQuery,
  ): Promise<OperationsRepositoryPage<MigrationRun>> {
    let statement = this.db
      .selectFrom("migration.run as run")
      .select([
        "run.id",
        "run.public_id",
        "run.source_system",
        "run.snapshot_sha256",
        "run.manifest_version",
        "run.transform_version",
        "run.state",
        "run.started_at",
        "run.finished_at",
        "run.blockers",
        sql<string | null>`run.mode`.as("mode"),
        sql<number | string>`run.expected_rows`.as("expected_rows"),
        sql<number | string>`run.processed_rows`.as("processed_rows"),
        sql<number | string>`run.already_applied_rows`.as("already_applied_rows"),
        sql<unknown>`run.outcome_counts`.as("outcome_counts"),
      ])
      .where(runScopeSql(scope));
    if (query.state) {
      statement = statement.where("run.state", "=", query.state);
    }
    if (query.mode) {
      statement = statement.where(sql<string>`run.mode`, "=", query.mode);
    }
    if (query.cursor) {
      statement = statement.where(cursorSql("run.started_at", "run.id", query.cursor));
    }
    const rows = (await statement
      .orderBy("run.started_at", "desc")
      .orderBy("run.id", "desc")
      .limit(query.limit + 1)
      .execute()) as MigrationRunRow[];
    return pageFromRows(rows, query.limit, (row) => row.started_at, mapRun);
  }

  async getMigrationRun(scope: OperationsAccessScope, publicId: string): Promise<MigrationRun | null> {
    const row = (await this.db
      .selectFrom("migration.run as run")
      .select([
        "run.id",
        "run.public_id",
        "run.source_system",
        "run.snapshot_sha256",
        "run.manifest_version",
        "run.transform_version",
        "run.state",
        "run.started_at",
        "run.finished_at",
        "run.blockers",
        sql<string | null>`run.mode`.as("mode"),
        sql<number | string>`run.expected_rows`.as("expected_rows"),
        sql<number | string>`run.processed_rows`.as("processed_rows"),
        sql<number | string>`run.already_applied_rows`.as("already_applied_rows"),
        sql<unknown>`run.outcome_counts`.as("outcome_counts"),
      ])
      .where("run.public_id", "=", publicId)
      .where(runScopeSql(scope))
      .executeTakeFirst()) as MigrationRunRow | undefined;
    return row ? mapRun(row) : null;
  }

  async listMigrationConflicts(
    scope: OperationsAccessScope,
    query: MigrationConflictRepositoryQuery,
  ): Promise<OperationsRepositoryPage<MigrationConflict>> {
    let statement = this.db
      .selectFrom("migration.conflict as conflict")
      .innerJoin("migration.run as run", "run.id", "conflict.run_id")
      .select([
        "conflict.id",
        "run.public_id as run_public_id",
        "conflict.conflict_type",
        "conflict.source_table",
        "conflict.severity",
        "conflict.state",
        "conflict.reason_code",
        "conflict.version",
        "conflict.created_at",
        "conflict.updated_at",
        "conflict.resolved_at",
        sql<string | null>`conflict.source_key_digest`.as("source_key_digest"),
        sql<boolean>`conflict.resolution is not null`.as("resolution_present"),
      ])
      .where("conflict.archived_at", "is", null)
      .where(runScopeSql(scope));
    if (query.runId) {
      statement = statement.where("run.public_id", "=", query.runId);
    }
    if (query.state) {
      statement = statement.where("conflict.state", "=", query.state);
    }
    if (query.severity) {
      statement = statement.where("conflict.severity", "=", query.severity);
    }
    if (query.cursor) {
      statement = statement.where(cursorSql("conflict.created_at", "conflict.id", query.cursor));
    }
    const rows = (await statement
      .orderBy("conflict.created_at", "desc")
      .orderBy("conflict.id", "desc")
      .limit(query.limit + 1)
      .execute()) as MigrationConflictRow[];
    return pageFromRows(rows, query.limit, (row) => row.created_at, mapConflict);
  }

  async getMigrationConflict(
    scope: OperationsAccessScope,
    conflictId: string,
  ): Promise<MigrationConflict | null> {
    const row = (await this.db
      .selectFrom("migration.conflict as conflict")
      .innerJoin("migration.run as run", "run.id", "conflict.run_id")
      .select([
        "conflict.id",
        "run.public_id as run_public_id",
        "conflict.conflict_type",
        "conflict.source_table",
        "conflict.severity",
        "conflict.state",
        "conflict.reason_code",
        "conflict.version",
        "conflict.created_at",
        "conflict.updated_at",
        "conflict.resolved_at",
        sql<string | null>`conflict.source_key_digest`.as("source_key_digest"),
        sql<boolean>`conflict.resolution is not null`.as("resolution_present"),
      ])
      .where("conflict.id", "=", conflictId)
      .where("conflict.archived_at", "is", null)
      .where(runScopeSql(scope))
      .executeTakeFirst()) as MigrationConflictRow | undefined;
    return row ? mapConflict(row) : null;
  }

  async listAuditEvents(
    scope: OperationsAccessScope,
    query: AuditEventRepositoryQuery,
  ): Promise<OperationsRepositoryPage<AuditEvent>> {
    let statement = this.db
      .selectFrom("platform.audit_event as event")
      .select([
        "event.id",
        "event.event_type",
        "event.actor_type",
        "event.subject_type",
        "event.request_id",
        "event.occurred_at",
        "event.event_hash",
        sql<boolean>`event.actor_id = ${scope.actorUserAccountId}::uuid`.as("actor_in_own_scope"),
        sql<boolean>`event.subject_id is not null`.as("subject_present"),
        sql<string | null>`case when event.reason ~ '^[A-Z0-9_]{1,128}$' then event.reason else null end`.as(
          "reason_code",
        ),
        sql<
          string | null
        >`case when event.policy_version ~ '^[A-Za-z0-9_.:-]{1,128}$' then event.policy_version else null end`.as(
          "policy_version",
        ),
        sql<boolean>`event.before_state is not null`.as("has_before_state"),
        sql<boolean>`event.after_state is not null`.as("has_after_state"),
        sql<boolean>`event.previous_hash is not null`.as("previous_hash_present"),
      ])
      .where(auditScopeSql(scope));
    if (query.eventType) {
      statement = statement.where("event.event_type", "=", query.eventType);
    }
    if (query.actorType) {
      statement = statement.where("event.actor_type", "=", query.actorType);
    }
    if (query.subjectType) {
      statement = statement.where("event.subject_type", "=", query.subjectType);
    }
    if (query.from) {
      statement = statement.where("event.occurred_at", ">=", new Date(query.from));
    }
    if (query.to) {
      statement = statement.where("event.occurred_at", "<=", new Date(query.to));
    }
    if (query.cursor) {
      statement = statement.where(cursorSql("event.occurred_at", "event.id", query.cursor));
    }
    const rows = (await statement
      .orderBy("event.occurred_at", "desc")
      .orderBy("event.id", "desc")
      .limit(query.limit + 1)
      .execute()) as AuditEventRow[];
    return pageFromRows(rows, query.limit, (row) => row.occurred_at, mapAuditEvent);
  }

  async readMetrics(scope: OperationsAccessScope): Promise<MetricsSnapshot> {
    if (scope.visibility !== "all") {
      throw new AppError(403, "permission_scope_denied", "Метрики требуют полный platform scope");
    }
    const [runResult, conflictResult, outboxResult, auditResult] = await Promise.all([
      sql<{
        dry_running: number | string;
        failed: number | string;
        completed: number | string;
      }>`select
          count(*) filter (where state = 'dry_running') as dry_running,
          count(*) filter (where state = 'failed') as failed,
          count(*) filter (where state = 'completed') as completed
        from migration.run`.execute(this.db),
      sql<{
        open_blocking: number | string;
        open_warning: number | string;
      }>`select
          count(*) filter (where state in ('open', 'assigned') and severity = 'blocking') as open_blocking,
          count(*) filter (where state in ('open', 'assigned') and severity = 'warning') as open_warning
        from migration.conflict
        where archived_at is null`.execute(this.db),
      sql<{
        pending: number | string;
        retrying: number | string;
      }>`select
          count(*) filter (where delivered_at is null) as pending,
          count(*) filter (where delivered_at is null and attempt_count > 0) as retrying
        from platform.outbox_event`.execute(this.db),
      sql<{ total: number | string }>`select count(*) as total from platform.audit_event`.execute(this.db),
    ]);

    const runs = runResult.rows[0];
    const conflicts = conflictResult.rows[0];
    const outbox = outboxResult.rows[0];
    const audit = auditResult.rows[0];
    return {
      migrationRuns: {
        dryRunning: nonNegativeInteger(runs?.dry_running),
        failed: nonNegativeInteger(runs?.failed),
        completed: nonNegativeInteger(runs?.completed),
      },
      migrationConflicts: {
        openBlocking: nonNegativeInteger(conflicts?.open_blocking),
        openWarning: nonNegativeInteger(conflicts?.open_warning),
      },
      outbox: {
        pending: nonNegativeInteger(outbox?.pending),
        retrying: nonNegativeInteger(outbox?.retrying),
      },
      auditEvents: nonNegativeInteger(audit?.total),
    };
  }
}
