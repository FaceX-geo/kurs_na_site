export const EXPECTED_SOURCE_SYSTEM = "bitrix" as const;

export const LEDGER_OUTCOMES = [
  "migrated",
  "linked_existing",
  "excluded_with_reason",
  "conflict_recorded",
  "quarantined",
] as const;

export const MIGRATION_PROJECTIONS = [
  "would_migrate",
  "would_quarantine",
  "would_conflict",
  "would_exclude",
] as const;

export const MIGRATION_TARGET_ACTIONS = ["create", "link", "stage"] as const;

export type LedgerOutcome = (typeof LEDGER_OUTCOMES)[number];
export type MigrationProjection = (typeof MIGRATION_PROJECTIONS)[number];
export type MigrationTargetAction = (typeof MIGRATION_TARGET_ACTIONS)[number];
export type MigrationRunMode = "dry-run" | "import";
export type MigrationIssueSeverity = "blocking" | "warning";
export type MigrationIssueCategory = "business-decision" | "registry" | "security" | "source-snapshot";

export interface MigrationIssue {
  readonly category: MigrationIssueCategory;
  readonly code: string;
  readonly evidence: Readonly<Record<string, boolean | number | string>>;
  readonly remediation: string;
  readonly severity: MigrationIssueSeverity;
  readonly summary: string;
}

export interface SourceKeyDefinition {
  readonly columns: readonly string[];
  readonly kind: "primary_key" | "unique_index";
}

export interface MigrationManifestEntity {
  readonly baselineCount: number;
  readonly classifierId?: string;
  readonly dependsOn: readonly string[];
  readonly expectedProjectionCounts?: Readonly<Record<MigrationProjection, number>>;
  readonly expectedRowOutcomes: number;
  readonly migrationQueryId: string;
  readonly sourceDisposition: "include_row_ledger" | "quarantine_only";
  readonly sourceKey: SourceKeyDefinition;
  readonly sourceTable: string;
  readonly targets: readonly string[];
  readonly transformVersion: string;
}

export interface MigrationManifest {
  readonly externalLinkBaselineRows: number;
  readonly fileName: string;
  readonly ledgerKeyComponents: readonly string[];
  readonly ledgerOutcomes: readonly string[];
  readonly manifestVersion: string;
  readonly productionCutoverRequiresFreshSnapshot: boolean;
  readonly rowOutcomeDenominator: number;
  readonly snapshotSha256: string;
  readonly sourceSystem: string;
  readonly entities: readonly MigrationManifestEntity[];
}

export interface MigrationRegistryQuery {
  readonly countSql?: string;
  readonly expectedRowOutcomes?: number;
  readonly expectedSourceRows?: number;
  readonly extractionSql?: string;
  readonly extractionSqlSha256?: string;
  readonly queryId: string;
  readonly queryKind: string;
  readonly sourceTable?: string;
  readonly transformVersion?: string;
}

export interface SourceTableDisposition {
  readonly decisionStatus: string;
  readonly disposition: "exclude_with_reason" | "include_row_ledger" | "quarantine_only";
  readonly expectedRowOutcomes: number;
  readonly migrationQueryId: string;
  readonly reasonCode: string;
  readonly rows: number;
  readonly sourceTable: string;
  readonly transformVersion: string;
}

export interface MigrationRegistryBundle {
  readonly declaredQueryCount: number;
  readonly dispositions: readonly SourceTableDisposition[];
  readonly manifest: MigrationManifest;
  readonly queries: readonly MigrationRegistryQuery[];
  readonly queryRegistrySha256: string;
  readonly registryDirectory: string;
  readonly sourceFieldMapSha256: string;
  readonly sourceFieldMapSourceSystem: string;
  readonly targetModelSha256: string;
}

export interface LegacyDumpInspection {
  readonly changeMasterStatements: number;
  readonly commitStatements: number;
  readonly compressedBytes: number;
  readonly completedAt: string | null;
  readonly dumpPath: string;
  readonly gtidMarkers: number;
  readonly lockTableStatements: number;
  readonly masterLogMarkers: number;
  readonly sha256: string;
  readonly startTransactionStatements: number;
  readonly unlockTableStatements: number;
}

export interface MigrationPreflightReport {
  readonly canDryRun: boolean;
  readonly canImport: boolean;
  readonly dispositionRowsInMigrationScope: number;
  readonly dump: LegacyDumpInspection | null;
  readonly generatedAt: string;
  readonly issues: readonly MigrationIssue[];
  readonly manifestRowsInMigrationScope: number;
  readonly registryDirectory: string;
  readonly snapshotSha256: string;
  readonly sourceSystem: string;
}

export interface MigrationPlanItem {
  readonly classifierId: string;
  readonly countSql: string;
  readonly dependsOn: readonly string[];
  readonly expectedProjectionCounts: Readonly<Record<MigrationProjection, number>>;
  readonly expectedRows: number;
  readonly extractionSql: string;
  readonly queryId: string;
  readonly sourceDisposition: "include_row_ledger" | "quarantine_only";
  readonly sourceKey: SourceKeyDefinition;
  readonly sourceTable: string;
  readonly targets: readonly string[];
  readonly transformVersion: string;
  readonly validationRules: readonly string[];
}

export interface MigrationPlan {
  readonly adapterRequirement: string;
  readonly blockerCodes: readonly string[];
  readonly generatedAt: string;
  readonly items: readonly MigrationPlanItem[];
  readonly manifestVersion: string;
  readonly snapshotSha256: string;
  readonly sourceSystem: typeof EXPECTED_SOURCE_SYSTEM;
  readonly totalExpectedRows: number;
  readonly totalExpectedProjectionCounts: Readonly<Record<MigrationProjection, number>>;
  readonly transformRegistryVersion: string;
}

export type LegacySourceKeyValue = boolean | number | string;

export interface LegacyRowEnvelope {
  readonly payload: unknown;
  readonly sourceKey: Readonly<Record<string, LegacySourceKeyValue>>;
}

export interface MigrationTargetIntent {
  readonly action: MigrationTargetAction;
  readonly projection: MigrationProjection;
  readonly reasonCode?: string;
  readonly targetEntity: string;
  readonly targetId?: string;
}

export interface MigrationDecision {
  readonly outcome: LedgerOutcome;
  readonly projection: MigrationProjection;
  readonly reasonCode?: string;
  readonly targetEntity?: string;
  readonly targetId?: string;
  readonly targetIntents: readonly MigrationTargetIntent[];
  readonly targetPayload?: unknown;
}

export interface MigrationLedgerRecord {
  readonly attempt: number;
  readonly attemptId?: string;
  readonly decision: Omit<MigrationDecision, "targetPayload">;
  readonly ledgerKey: string;
  readonly recordedAt: string;
  readonly runId: string;
  readonly snapshotSha256: string;
  readonly sourceKeyDigest: string;
  readonly sourceTable: string;
  readonly transformVersion: string;
}

export interface MigrationRunSummary {
  readonly alreadyAppliedRows: number;
  readonly completedAt: string;
  readonly expectedRows: number;
  readonly outcomeCounts: Readonly<Record<LedgerOutcome, number>>;
  readonly projectionCounts: Readonly<Record<MigrationProjection, number>>;
  readonly processedRows: number;
  readonly runId: string;
  readonly runMode: MigrationRunMode;
  readonly sourceTables: number;
  readonly targetProjectionCounts: Readonly<Record<MigrationProjection, number>>;
}
