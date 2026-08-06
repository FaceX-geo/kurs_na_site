import { randomUUID } from "node:crypto";
import { MigrationError } from "./errors.js";
import { buildLedgerIdentity } from "./ledger-key.js";
import type {
  AtomicMigrationResult,
  LegacySourcePort,
  MigrationClassifierPort,
  MigrationUnitOfWorkPort,
} from "./ports.js";
import type {
  LedgerOutcome,
  MigrationDecision,
  MigrationPlan,
  MigrationPreflightReport,
  MigrationProjection,
  MigrationRunMode,
  MigrationRunSummary,
} from "./types.js";
import {
  EXPECTED_SOURCE_SYSTEM,
  LEDGER_OUTCOMES,
  MIGRATION_PROJECTIONS,
  MIGRATION_TARGET_ACTIONS,
} from "./types.js";

export interface ExecuteMigrationInput {
  readonly classifier: MigrationClassifierPort;
  readonly clock?: () => Date;
  readonly idFactory?: () => string;
  readonly mode: MigrationRunMode;
  readonly plan: MigrationPlan;
  readonly preflight: MigrationPreflightReport;
  readonly signal?: AbortSignal;
  readonly source: LegacySourcePort;
  readonly unitOfWork: MigrationUnitOfWorkPort;
  /** Bounded concurrent ledger writes; source streaming and classification remain ordered. */
  readonly writeConcurrency?: number;
}

interface PendingLedgerWrite {
  readonly decision: MigrationDecision;
  readonly ledgerKey: string;
  readonly sourceKeyDigest: string;
  readonly sourceTable: string;
  readonly transformVersion: string;
  readonly result: Promise<AtomicMigrationResult>;
}

function emptyOutcomeCounts(): Record<LedgerOutcome, number> {
  return {
    conflict_recorded: 0,
    excluded_with_reason: 0,
    linked_existing: 0,
    migrated: 0,
    quarantined: 0,
  };
}

function emptyProjectionCounts(): Record<MigrationProjection, number> {
  return {
    would_conflict: 0,
    would_exclude: 0,
    would_migrate: 0,
    would_quarantine: 0,
  };
}

function validateDecision(decision: MigrationDecision, targets: readonly string[]): void {
  if (!LEDGER_OUTCOMES.includes(decision.outcome)) {
    throw new MigrationError("LEDGER_OUTCOME_INVALID", "Classifier returned an unsupported ledger outcome");
  }

  if (!MIGRATION_PROJECTIONS.includes(decision.projection)) {
    throw new MigrationError(
      "MIGRATION_PROJECTION_INVALID",
      "Classifier returned an unsupported dry-run projection",
    );
  }

  if (
    (decision.outcome === "excluded_with_reason" ||
      decision.outcome === "conflict_recorded" ||
      decision.outcome === "quarantined") &&
    (decision.reasonCode === undefined || decision.reasonCode.length === 0)
  ) {
    throw new MigrationError(
      "LEDGER_REASON_REQUIRED",
      `Ledger outcome ${decision.outcome} requires a stable reason code`,
    );
  }

  if (decision.outcome === "migrated" || decision.outcome === "linked_existing") {
    if (
      decision.targetEntity === undefined ||
      decision.targetId === undefined ||
      !targets.includes(decision.targetEntity)
    ) {
      throw new MigrationError(
        "TARGET_DECISION_INVALID",
        "Successful migration outcome requires an allowlisted target entity and target ID",
      );
    }
  }

  const targetIdentities = new Set<string>();
  for (const intent of decision.targetIntents) {
    if (
      !MIGRATION_TARGET_ACTIONS.includes(intent.action) ||
      !MIGRATION_PROJECTIONS.includes(intent.projection) ||
      !targets.includes(intent.targetEntity)
    ) {
      throw new MigrationError(
        "MIGRATION_TARGET_INTENT_INVALID",
        "Classifier returned a target intent outside the versioned plan contract",
      );
    }
    const identity = `${intent.action}:${intent.targetEntity}`;
    if (targetIdentities.has(identity)) {
      throw new MigrationError(
        "MIGRATION_TARGET_INTENT_INVALID",
        "Classifier returned duplicate target intents for one source row",
      );
    }
    targetIdentities.add(identity);
    if (
      intent.projection !== "would_migrate" &&
      (intent.reasonCode === undefined || intent.reasonCode.length === 0)
    ) {
      throw new MigrationError(
        "MIGRATION_TARGET_INTENT_INVALID",
        "Blocked target intents require a stable reason code",
      );
    }
  }
  if (
    decision.projection === "would_migrate" &&
    !decision.targetIntents.some((intent) => intent.projection === "would_migrate")
  ) {
    throw new MigrationError(
      "MIGRATION_TARGET_INTENT_INVALID",
      "A would_migrate projection requires at least one ready target intent",
    );
  }
}

function assertProjectionCounts(
  actual: Readonly<Record<MigrationProjection, number>>,
  expected: Readonly<Record<MigrationProjection, number>>,
  sourceTable: string,
): void {
  if (MIGRATION_PROJECTIONS.some((projection) => actual[projection] !== expected[projection])) {
    throw new MigrationError(
      "MIGRATION_CLASSIFIER_COUNT_MISMATCH",
      `Dry-run projection counts drifted for table ${sourceTable}`,
    );
  }
}

function assertRunAllowed(input: ExecuteMigrationInput): void {
  if (input.plan.sourceSystem !== EXPECTED_SOURCE_SYSTEM) {
    throw new MigrationError("SOURCE_SYSTEM_MISMATCH", "Migration plan source system is not bitrix");
  }
  if (input.plan.snapshotSha256 !== input.preflight.snapshotSha256) {
    throw new MigrationError(
      "PLAN_PREFLIGHT_MISMATCH",
      "Migration plan and preflight use different snapshots",
    );
  }
  if (input.mode === "import" && !input.preflight.canImport) {
    throw new MigrationError("IMPORT_PREFLIGHT_BLOCKED", "Import is blocked by unresolved preflight issues");
  }
  if (input.mode === "import") {
    throw new MigrationError(
      "IMPORT_CANONICAL_TRANSFORMS_REQUIRED",
      "Import remains disabled until every planned table-specific canonical transform is implemented and verified",
    );
  }
  if (input.mode === "dry-run" && !input.preflight.canDryRun) {
    throw new MigrationError("DRY_RUN_PREFLIGHT_BLOCKED", "Dry-run is blocked by registry integrity issues");
  }
}

function resolveWriteConcurrency(value: number | undefined): number {
  const resolved = value ?? 10;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > 32) {
    throw new MigrationError(
      "MIGRATION_WRITE_CONCURRENCY_INVALID",
      "Migration write concurrency must be an integer between 1 and 32",
    );
  }
  return resolved;
}

export async function executeMigration(input: ExecuteMigrationInput): Promise<MigrationRunSummary> {
  assertRunAllowed(input);
  const identity = await input.source.getIdentity(input.signal);
  if (identity.sourceSystem !== EXPECTED_SOURCE_SYSTEM || identity.sha256 !== input.plan.snapshotSha256) {
    throw new MigrationError(
      "SOURCE_ADAPTER_IDENTITY_MISMATCH",
      "Legacy source adapter identity differs from the migration plan",
    );
  }

  const clock = input.clock ?? (() => new Date());
  const runId = (input.idFactory ?? randomUUID)();
  const startedAt = clock().toISOString();
  const outcomeCounts = emptyOutcomeCounts();
  const projectionCounts = emptyProjectionCounts();
  const targetProjectionCounts = emptyProjectionCounts();
  const writeConcurrency = resolveWriteConcurrency(input.writeConcurrency);
  let alreadyAppliedRows = 0;
  let processedRows = 0;
  let runStarted = false;

  try {
    await input.unitOfWork.beginRun(
      {
        adapterName: input.source.adapterName,
        blockerCodes: input.plan.blockerCodes,
        expectedRows: input.plan.totalExpectedRows,
        manifestVersion: input.plan.manifestVersion,
        mode: input.mode,
        runId,
        snapshotSha256: input.plan.snapshotSha256,
        sourceSystem: input.plan.sourceSystem,
        startedAt,
        transformRegistryVersion: input.plan.transformRegistryVersion,
      },
      input.signal,
    );
    runStarted = true;

    const acceptWriteResults = async (
      pending: PendingLedgerWrite[],
      itemProjectionCounts: Record<MigrationProjection, number>,
    ): Promise<void> => {
      const settled = await Promise.allSettled(pending.map((write) => write.result));
      let firstFailure: unknown;
      for (const [index, outcome] of settled.entries()) {
        const expected = pending[index];
        if (!expected) {
          throw new MigrationError("MIGRATION_EXECUTION_FAILED", "Migration write queue lost its contract");
        }
        if (outcome.status === "rejected") {
          firstFailure ??= outcome.reason;
          continue;
        }
        const result = outcome.value;
        if (
          result.record.ledgerKey !== expected.ledgerKey ||
          result.record.sourceKeyDigest !== expected.sourceKeyDigest ||
          result.record.snapshotSha256 !== input.plan.snapshotSha256 ||
          result.record.sourceTable !== expected.sourceTable ||
          result.record.transformVersion !== expected.transformVersion ||
          result.record.decision.outcome !== expected.decision.outcome ||
          result.record.decision.projection !== expected.decision.projection
        ) {
          firstFailure ??= new MigrationError(
            "LEDGER_ATOMICITY_CONTRACT_VIOLATION",
            "Unit-of-work adapter returned a different ledger identity or outcome",
          );
          continue;
        }

        processedRows += 1;
        outcomeCounts[result.record.decision.outcome] += 1;
        projectionCounts[result.record.decision.projection] += 1;
        itemProjectionCounts[result.record.decision.projection] += 1;
        for (const intent of result.record.decision.targetIntents) {
          targetProjectionCounts[intent.projection] += 1;
        }
        if (result.status === "already-applied") {
          alreadyAppliedRows += 1;
        }
      }
      if (firstFailure !== undefined) {
        throw firstFailure;
      }
    };

    for (const item of input.plan.items) {
      const countedRows = await input.source.countRows(item, input.signal);
      if (countedRows !== item.expectedRows) {
        throw new MigrationError(
          "SOURCE_COUNT_MISMATCH",
          `Source row count drifted for table ${item.sourceTable}`,
        );
      }

      let streamedRows = 0;
      const itemProjectionCounts = emptyProjectionCounts();
      let pending: PendingLedgerWrite[] = [];
      for await (const row of input.source.streamRows(item, input.signal)) {
        streamedRows += 1;
        const decision = await input.classifier.classify(item, row, input.signal);
        validateDecision(decision, item.targets);
        const ledgerIdentity = buildLedgerIdentity(
          input.plan.snapshotSha256,
          input.plan.sourceSystem,
          item,
          row,
        );
        const result = input.unitOfWork.applyRowAtomically(
          {
            decision,
            ledgerKey: ledgerIdentity.ledgerKey,
            mode: input.mode,
            row,
            runId,
            snapshotSha256: input.plan.snapshotSha256,
            sourceKeyDigest: ledgerIdentity.sourceKeyDigest,
            sourceTable: item.sourceTable,
            transformVersion: item.transformVersion,
          },
          input.signal,
        );
        pending.push({
          decision,
          ledgerKey: ledgerIdentity.ledgerKey,
          sourceKeyDigest: ledgerIdentity.sourceKeyDigest,
          sourceTable: item.sourceTable,
          transformVersion: item.transformVersion,
          result,
        });
        if (pending.length >= writeConcurrency) {
          await acceptWriteResults(pending, itemProjectionCounts);
          pending = [];
        }
      }
      if (pending.length > 0) {
        await acceptWriteResults(pending, itemProjectionCounts);
      }

      if (streamedRows !== item.expectedRows) {
        throw new MigrationError(
          "SOURCE_STREAM_COUNT_MISMATCH",
          `Source stream row count drifted for table ${item.sourceTable}`,
        );
      }
      assertProjectionCounts(itemProjectionCounts, item.expectedProjectionCounts, item.sourceTable);
    }

    const summary: MigrationRunSummary = {
      alreadyAppliedRows,
      completedAt: clock().toISOString(),
      expectedRows: input.plan.totalExpectedRows,
      outcomeCounts,
      projectionCounts,
      processedRows,
      runId,
      runMode: input.mode,
      sourceTables: input.plan.items.length,
      targetProjectionCounts,
    };
    await input.unitOfWork.completeRun(summary, input.signal);
    return summary;
  } catch (error) {
    const migrationError =
      error instanceof MigrationError
        ? error
        : new MigrationError("MIGRATION_EXECUTION_FAILED", "Migration execution failed safely", {
            cause: error,
          });
    if (runStarted) {
      try {
        await input.unitOfWork.failRun(runId, migrationError.code);
      } catch (failureRecordError) {
        throw new MigrationError(
          "MIGRATION_FAILURE_RECORD_FAILED",
          `Migration stopped with ${migrationError.code}, but its run failure state could not be recorded`,
          { cause: new AggregateError([migrationError, failureRecordError]) },
        );
      }
    }
    throw migrationError;
  }
}
