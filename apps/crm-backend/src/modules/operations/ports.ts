import type { CursorValue, Page } from "../../common/pagination.js";
import type {
  AuditEvent,
  AuditEventListQuery,
  MigrationConflict,
  MigrationConflictListQuery,
  MigrationRun,
  MigrationRunListQuery,
} from "./contracts.js";
import type { OperationsOperationDefinition } from "./registry.js";

export interface OperationsActorContext {
  readonly userAccountId: string;
  readonly requestId: string;
}

export interface OperationsAccessScope {
  readonly visibility: "all" | "self" | "restricted";
  readonly actorUserAccountId: string;
  /** Migration run IDs or audit subject IDs. Empty means deny, never all. */
  readonly resourceIds: readonly string[];
  /** Audit-only: include events performed by the current actor. */
  readonly includeActorEvents: boolean;
}

export interface OperationsAuthorizationPort {
  authorize(
    actor: OperationsActorContext,
    operation: OperationsOperationDefinition,
  ): Promise<OperationsAccessScope>;
}

export interface OperationsRepositoryPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: CursorValue | null;
  readonly hasMore: boolean;
}

export interface OperationsRepositoryPageRequest {
  readonly cursor: CursorValue | undefined;
  readonly limit: number;
}

export type MigrationRunRepositoryQuery = Omit<MigrationRunListQuery, "cursor" | "limit"> &
  OperationsRepositoryPageRequest;
export type MigrationConflictRepositoryQuery = Omit<MigrationConflictListQuery, "cursor" | "limit"> &
  OperationsRepositoryPageRequest;
export type AuditEventRepositoryQuery = Omit<AuditEventListQuery, "cursor" | "limit"> &
  OperationsRepositoryPageRequest;

export interface MetricsSnapshot {
  readonly migrationRuns: Readonly<{
    dryRunning: number;
    failed: number;
    completed: number;
  }>;
  readonly migrationConflicts: Readonly<{
    openBlocking: number;
    openWarning: number;
  }>;
  readonly outbox: Readonly<{
    pending: number;
    retrying: number;
  }>;
  readonly auditEvents: number;
}

export interface OperationsReadRepositoryPort {
  listMigrationRuns(
    scope: OperationsAccessScope,
    query: MigrationRunRepositoryQuery,
  ): Promise<OperationsRepositoryPage<MigrationRun>>;
  getMigrationRun(scope: OperationsAccessScope, publicId: string): Promise<MigrationRun | null>;
  listMigrationConflicts(
    scope: OperationsAccessScope,
    query: MigrationConflictRepositoryQuery,
  ): Promise<OperationsRepositoryPage<MigrationConflict>>;
  getMigrationConflict(scope: OperationsAccessScope, conflictId: string): Promise<MigrationConflict | null>;
  listAuditEvents(
    scope: OperationsAccessScope,
    query: AuditEventRepositoryQuery,
  ): Promise<OperationsRepositoryPage<AuditEvent>>;
  readMetrics(scope: OperationsAccessScope): Promise<MetricsSnapshot>;
}

export interface OperationsReadServicePort {
  listMigrationRuns(actor: OperationsActorContext, query: MigrationRunListQuery): Promise<Page<MigrationRun>>;
  getMigrationRun(actor: OperationsActorContext, runId: string): Promise<MigrationRun>;
  listMigrationConflicts(
    actor: OperationsActorContext,
    query: MigrationConflictListQuery,
  ): Promise<Page<MigrationConflict>>;
  getMigrationConflict(actor: OperationsActorContext, conflictId: string): Promise<MigrationConflict>;
  listAuditEvents(actor: OperationsActorContext, query: AuditEventListQuery): Promise<Page<AuditEvent>>;
  readMetrics(actor: OperationsActorContext): Promise<string>;
}
