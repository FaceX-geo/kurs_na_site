import { describe, expect, it } from "vitest";
import type {
  AtomicMigrationRequest,
  AtomicMigrationResult,
  LegacyRowEnvelope,
  LegacySourcePort,
  MigrationClassifierPort,
  MigrationDecision,
  MigrationLedgerRecord,
  MigrationPlan,
  MigrationPreflightReport,
  MigrationRunStart,
  MigrationRunSummary,
  MigrationUnitOfWorkPort,
} from "../src/modules/migration/index.js";
import { executeMigration, type MigrationError } from "../src/modules/migration/index.js";

const snapshotSha256 = "a".repeat(64);

function testPlan(expectedRows = 2): MigrationPlan {
  return {
    adapterRequirement: "test",
    blockerCodes: [],
    generatedAt: "2026-08-06T12:00:00.000Z",
    items: [
      {
        classifierId: "test-classifier-v1",
        countSql: "SELECT COUNT(*) AS source_rows FROM `b_crm_contact`",
        dependsOn: [],
        expectedProjectionCounts: {
          would_conflict: 0,
          would_exclude: 0,
          would_migrate: expectedRows,
          would_quarantine: 0,
        },
        expectedRows,
        extractionSql: "SELECT `ID` FROM `b_crm_contact` ORDER BY `ID`",
        queryId: "MIG-Q-CONTACTS-V1",
        sourceDisposition: "include_row_ledger",
        sourceKey: { columns: ["ID"], kind: "primary_key" },
        sourceTable: "b_crm_contact",
        targets: ["crm.crm_profile"],
        transformVersion: "contact-v1",
        validationRules: ["test"],
      },
    ],
    manifestVersion: "test-v1",
    snapshotSha256,
    sourceSystem: "bitrix",
    totalExpectedRows: expectedRows,
    totalExpectedProjectionCounts: {
      would_conflict: 0,
      would_exclude: 0,
      would_migrate: expectedRows,
      would_quarantine: 0,
    },
    transformRegistryVersion: "test-transform-registry-v1",
  };
}

function testPreflight(canImport = true): MigrationPreflightReport {
  return {
    canDryRun: true,
    canImport,
    dispositionRowsInMigrationScope: 2,
    dump: null,
    generatedAt: "2026-08-06T12:00:00.000Z",
    issues: canImport
      ? []
      : [
          {
            category: "business-decision",
            code: "TEST_BLOCKER",
            evidence: { rows: 1 },
            remediation: "Resolve test blocker",
            severity: "blocking",
            summary: "Test blocker",
          },
        ],
    manifestRowsInMigrationScope: 2,
    registryDirectory: "/registries",
    snapshotSha256,
    sourceSystem: "bitrix",
  };
}

class FakeSource implements LegacySourcePort {
  public readonly adapterName = "fake-read-only";
  private readonly rows: readonly LegacyRowEnvelope[];
  private readonly reportedCount: number;

  public constructor(rows: readonly LegacyRowEnvelope[], reportedCount = rows.length) {
    this.rows = rows;
    this.reportedCount = reportedCount;
  }

  public async countRows(): Promise<number> {
    return this.reportedCount;
  }

  public async getIdentity(): Promise<{ sha256: string; sourceSystem: string }> {
    return { sha256: snapshotSha256, sourceSystem: "bitrix" };
  }

  public async *streamRows(): AsyncIterable<LegacyRowEnvelope> {
    for (const row of this.rows) {
      yield row;
    }
  }
}

class FakeClassifier implements MigrationClassifierPort {
  public async classify(
    _item: MigrationPlan["items"][number],
    row: LegacyRowEnvelope,
  ): Promise<MigrationDecision> {
    return {
      outcome: "migrated",
      projection: "would_migrate",
      targetEntity: "crm.crm_profile",
      targetId: `profile-${String(row.sourceKey.ID)}`,
      targetIntents: [
        {
          action: "create",
          projection: "would_migrate",
          targetEntity: "crm.crm_profile",
        },
      ],
      targetPayload: row.payload,
    };
  }
}

class FakeUnitOfWork implements MigrationUnitOfWorkPort {
  public readonly completed: MigrationRunSummary[] = [];
  public readonly failed: Array<{ reasonCode: string; runId: string }> = [];
  public readonly ledgerKeys = new Set<string>();
  public readonly records: MigrationLedgerRecord[] = [];
  public readonly runs: MigrationRunStart[] = [];

  public async applyRowAtomically(request: AtomicMigrationRequest): Promise<AtomicMigrationResult> {
    const status = this.ledgerKeys.has(request.ledgerKey) ? "already-applied" : "recorded";
    this.ledgerKeys.add(request.ledgerKey);
    const persistedDecision: MigrationLedgerRecord["decision"] = {
      outcome: request.decision.outcome,
      projection: request.decision.projection,
      targetIntents: request.decision.targetIntents,
      ...(request.decision.reasonCode === undefined ? {} : { reasonCode: request.decision.reasonCode }),
      ...(request.decision.targetEntity === undefined ? {} : { targetEntity: request.decision.targetEntity }),
      ...(request.decision.targetId === undefined ? {} : { targetId: request.decision.targetId }),
    };
    const record: MigrationLedgerRecord = {
      attempt: 1,
      decision: persistedDecision,
      ledgerKey: request.ledgerKey,
      recordedAt: "2026-08-06T12:01:00.000Z",
      runId: request.runId,
      snapshotSha256: request.snapshotSha256,
      sourceKeyDigest: request.sourceKeyDigest,
      sourceTable: request.sourceTable,
      transformVersion: request.transformVersion,
    };
    this.records.push(record);
    return { record, status };
  }

  public async beginRun(run: MigrationRunStart): Promise<void> {
    this.runs.push(run);
  }

  public async completeRun(summary: MigrationRunSummary): Promise<void> {
    this.completed.push(summary);
  }

  public async failRun(runId: string, reasonCode: string): Promise<void> {
    this.failed.push({ reasonCode, runId });
  }
}

class ObservedConcurrentUnitOfWork extends FakeUnitOfWork {
  public activeWrites = 0;
  public maximumActiveWrites = 0;

  public override async applyRowAtomically(request: AtomicMigrationRequest): Promise<AtomicMigrationResult> {
    this.activeWrites += 1;
    this.maximumActiveWrites = Math.max(this.maximumActiveWrites, this.activeWrites);
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 2));
      return await super.applyRowAtomically(request);
    } finally {
      this.activeWrites -= 1;
    }
  }
}

const sourceRows: readonly LegacyRowEnvelope[] = [
  { payload: { email: "private-one@example.invalid" }, sourceKey: { ID: 1 } },
  { payload: { email: "private-two@example.invalid" }, sourceKey: { ID: 2 } },
];

describe("migration orchestrator", () => {
  it("records aggregate outcomes without exposing source payloads and is idempotent", async () => {
    const unitOfWork = new FakeUnitOfWork();
    const common = {
      classifier: new FakeClassifier(),
      clock: () => new Date("2026-08-06T12:00:00Z"),
      mode: "dry-run" as const,
      plan: testPlan(),
      preflight: testPreflight(),
      source: new FakeSource(sourceRows),
      unitOfWork,
    };

    const first = await executeMigration({ ...common, idFactory: () => "run-1" });
    const second = await executeMigration({ ...common, idFactory: () => "run-2" });

    expect(first.processedRows).toBe(2);
    expect(first.alreadyAppliedRows).toBe(0);
    expect(second.alreadyAppliedRows).toBe(2);
    expect(first.outcomeCounts.migrated).toBe(2);
    expect(JSON.stringify(first)).not.toContain("private-one");
    expect(unitOfWork.records[0]?.ledgerKey).toMatch(/^[a-f0-9]{64}$/u);
    expect(unitOfWork.records[0]?.sourceKeyDigest).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("blocks import when preflight has unresolved issues", async () => {
    await expect(
      executeMigration({
        classifier: new FakeClassifier(),
        idFactory: () => "run-blocked",
        mode: "import",
        plan: testPlan(),
        preflight: testPreflight(false),
        source: new FakeSource(sourceRows),
        unitOfWork: new FakeUnitOfWork(),
      }),
    ).rejects.toMatchObject({ code: "IMPORT_PREFLIGHT_BLOCKED" });
  });

  it("keeps import fail-closed after preflight until canonical transforms exist", async () => {
    const unitOfWork = new FakeUnitOfWork();
    await expect(
      executeMigration({
        classifier: new FakeClassifier(),
        idFactory: () => "run-without-transforms",
        mode: "import",
        plan: testPlan(),
        preflight: testPreflight(true),
        source: new FakeSource(sourceRows),
        unitOfWork,
      }),
    ).rejects.toMatchObject({ code: "IMPORT_CANONICAL_TRANSFORMS_REQUIRED" });
    expect(unitOfWork.runs).toEqual([]);
  });

  it("fails closed before streaming when source counts drift", async () => {
    const unitOfWork = new FakeUnitOfWork();
    await expect(
      executeMigration({
        classifier: new FakeClassifier(),
        idFactory: () => "run-count-drift",
        mode: "dry-run",
        plan: testPlan(),
        preflight: testPreflight(),
        source: new FakeSource(sourceRows, 3),
        unitOfWork,
      }),
    ).rejects.toEqual(expect.objectContaining<Partial<MigrationError>>({ code: "SOURCE_COUNT_MISMATCH" }));
    expect(unitOfWork.failed).toEqual([{ reasonCode: "SOURCE_COUNT_MISMATCH", runId: "run-count-drift" }]);
  });

  it("bounds concurrent ledger writes while preserving aggregate counts", async () => {
    const rows = Array.from({ length: 12 }, (_, index) => ({
      payload: { ordinal: index + 1 },
      sourceKey: { ID: index + 1 },
    }));
    const unitOfWork = new ObservedConcurrentUnitOfWork();

    const summary = await executeMigration({
      classifier: new FakeClassifier(),
      idFactory: () => "run-concurrent",
      mode: "dry-run",
      plan: testPlan(rows.length),
      preflight: testPreflight(),
      source: new FakeSource(rows),
      unitOfWork,
      writeConcurrency: 3,
    });

    expect(summary.processedRows).toBe(rows.length);
    expect(unitOfWork.maximumActiveWrites).toBe(3);
  });
});
