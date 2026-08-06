import type {
  LegacyRowEnvelope,
  MigrationDecision,
  MigrationLedgerRecord,
  MigrationPlanItem,
  MigrationRunMode,
  MigrationRunSummary,
} from "./types.js";

export interface LegacySourceIdentity {
  readonly sha256: string;
  readonly sourceSystem: string;
}

export interface LegacySourcePort {
  readonly adapterName: string;
  countRows(item: MigrationPlanItem, signal?: AbortSignal): Promise<number>;
  getIdentity(signal?: AbortSignal): Promise<LegacySourceIdentity>;
  streamRows(item: MigrationPlanItem, signal?: AbortSignal): AsyncIterable<LegacyRowEnvelope>;
}

export interface MigrationClassifierPort {
  classify(item: MigrationPlanItem, row: LegacyRowEnvelope, signal?: AbortSignal): Promise<MigrationDecision>;
}

export interface MigrationRunStart {
  readonly adapterName: string;
  readonly blockerCodes: readonly string[];
  readonly expectedRows: number;
  readonly manifestVersion: string;
  readonly mode: MigrationRunMode;
  readonly runId: string;
  readonly snapshotSha256: string;
  readonly sourceSystem: string;
  readonly startedAt: string;
  readonly transformRegistryVersion: string;
}

export interface AtomicMigrationRequest {
  readonly decision: MigrationDecision;
  readonly ledgerKey: string;
  readonly mode: MigrationRunMode;
  readonly row: LegacyRowEnvelope;
  readonly runId: string;
  readonly snapshotSha256: string;
  readonly sourceKeyDigest: string;
  readonly sourceTable: string;
  readonly transformVersion: string;
}

export interface AtomicMigrationResult {
  readonly record: MigrationLedgerRecord;
  readonly status: "already-applied" | "recorded";
}

/**
 * A concrete adapter must commit target mutation, field provenance, outbox events,
 * and the current ledger outcome in one database transaction. Dry-run adapters
 * must write only to an isolated run ledger and never mutate canonical targets.
 */
export interface MigrationUnitOfWorkPort {
  applyRowAtomically(request: AtomicMigrationRequest, signal?: AbortSignal): Promise<AtomicMigrationResult>;
  beginRun(run: MigrationRunStart, signal?: AbortSignal): Promise<void>;
  completeRun(summary: MigrationRunSummary, signal?: AbortSignal): Promise<void>;
  failRun(runId: string, reasonCode: string, signal?: AbortSignal): Promise<void>;
}
