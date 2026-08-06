import type {
  LegacyDumpInspection,
  MigrationIssue,
  MigrationPreflightReport,
  MigrationRegistryBundle,
  SourceTableDisposition,
} from "./types.js";
import { EXPECTED_SOURCE_SYSTEM, LEDGER_OUTCOMES } from "./types.js";

const EXPECTED_LEDGER_KEY_COMPONENTS = [
  "snapshot_sha256",
  "source_table",
  "canonical_json(source_key)",
  "transform_version",
] as const;

const DRY_RUN_BLOCKING_CODES = new Set([
  "DUMP_COMPLETION_MARKER_MISSING",
  "DUMP_LOCK_BALANCE_INVALID",
  "DUMP_SHA256_MISMATCH",
  "LEDGER_CONTRACT_INVALID",
  "MANIFEST_DENOMINATOR_INVALID",
  "MANIFEST_DISPOSITION_MISMATCH",
  "MANIFEST_QUERY_MISSING",
  "MANIFEST_QUERY_MISMATCH",
  "REGISTRY_DUPLICATE_IDENTIFIER",
  "REGISTRY_QUERY_COUNT_MISMATCH",
  "REGISTRY_SNAPSHOT_SHA256_MISMATCH",
  "SOURCE_DUMP_NOT_INSPECTED",
  "SOURCE_SYSTEM_MISMATCH",
]);

function issue(
  code: string,
  category: MigrationIssue["category"],
  summary: string,
  remediation: string,
  evidence: MigrationIssue["evidence"],
  severity: MigrationIssue["severity"] = "blocking",
): MigrationIssue {
  return { category, code, evidence, remediation, severity, summary };
}

function sumRows(dispositions: readonly SourceTableDisposition[]): number {
  return dispositions.reduce((total, disposition) => total + disposition.rows, 0);
}

function findDisposition(
  registries: MigrationRegistryBundle,
  sourceTable: string,
): SourceTableDisposition | undefined {
  return registries.dispositions.find((disposition) => disposition.sourceTable === sourceTable);
}

function sameMembers(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

function validateRegistryIdentity(registries: MigrationRegistryBundle, issues: MigrationIssue[]): void {
  if (
    registries.manifest.sourceSystem !== EXPECTED_SOURCE_SYSTEM ||
    registries.sourceFieldMapSourceSystem !== EXPECTED_SOURCE_SYSTEM
  ) {
    issues.push(
      issue(
        "SOURCE_SYSTEM_MISMATCH",
        "registry",
        "Authoritative registries do not agree on source_system=bitrix",
        "Pin every migration registry and ledger key to the immutable source_system value bitrix",
        {
          expected: EXPECTED_SOURCE_SYSTEM,
          manifest: registries.manifest.sourceSystem,
          sourceFieldMap: registries.sourceFieldMapSourceSystem,
        },
      ),
    );
  }

  const expectedSha = registries.manifest.snapshotSha256;
  const registryShas = [
    registries.queryRegistrySha256,
    registries.sourceFieldMapSha256,
    registries.targetModelSha256,
  ];
  if (registryShas.some((sha) => sha !== expectedSha)) {
    issues.push(
      issue(
        "REGISTRY_SNAPSHOT_SHA256_MISMATCH",
        "registry",
        "Migration registries are pinned to different source snapshots",
        "Regenerate every authoritative registry from one immutable source snapshot",
        {
          manifestSha256: expectedSha,
          mismatchedRegistries: registryShas.filter((sha) => sha !== expectedSha).length,
        },
      ),
    );
  }

  if (
    !sameMembers(registries.manifest.ledgerOutcomes, LEDGER_OUTCOMES) ||
    !sameMembers(registries.manifest.ledgerKeyComponents, EXPECTED_LEDGER_KEY_COMPONENTS)
  ) {
    issues.push(
      issue(
        "LEDGER_CONTRACT_INVALID",
        "registry",
        "Ledger outcomes or immutable key components drifted from the backend contract",
        "Regenerate the manifest or explicitly version the backend ledger contract",
        {
          expectedKeyComponents: EXPECTED_LEDGER_KEY_COMPONENTS.length,
          expectedOutcomes: LEDGER_OUTCOMES.length,
          registryKeyComponents: registries.manifest.ledgerKeyComponents.length,
          registryOutcomes: registries.manifest.ledgerOutcomes.length,
        },
      ),
    );
  }
}

function validateRegistryUniqueness(registries: MigrationRegistryBundle, issues: MigrationIssue[]): void {
  const duplicateCount = (values: readonly string[]): number => values.length - new Set(values).size;
  const duplicateSourceTables = duplicateCount(
    registries.manifest.entities.map((entity) => entity.sourceTable),
  );
  const duplicateQueryIds = duplicateCount(registries.queries.map((query) => query.queryId));
  const duplicateDispositions = duplicateCount(
    registries.dispositions.map((disposition) => disposition.sourceTable),
  );

  if (duplicateSourceTables + duplicateQueryIds + duplicateDispositions > 0) {
    issues.push(
      issue(
        "REGISTRY_DUPLICATE_IDENTIFIER",
        "registry",
        "Migration registries contain duplicate table or query identifiers",
        "Regenerate registries with unique source_table and query_id values",
        { duplicateDispositions, duplicateQueryIds, duplicateSourceTables },
      ),
    );
  }

  if (registries.declaredQueryCount !== registries.queries.length) {
    issues.push(
      issue(
        "REGISTRY_QUERY_COUNT_MISMATCH",
        "registry",
        "Declared migration query count does not match the registry array",
        "Regenerate the migration query registry and rerun preflight",
        { actual: registries.queries.length, declared: registries.declaredQueryCount },
      ),
    );
  }
}

function validateManifestQueries(registries: MigrationRegistryBundle, issues: MigrationIssue[]): void {
  const queryById = new Map(registries.queries.map((query) => [query.queryId, query]));

  for (const entity of registries.manifest.entities) {
    const query = queryById.get(entity.migrationQueryId);
    if (query === undefined || query.queryKind !== "source_extract") {
      issues.push(
        issue(
          "MANIFEST_QUERY_MISSING",
          "registry",
          "Manifest entity has no authoritative source_extract query",
          "Add one allowlisted source_extract query for every manifest entity",
          { queryId: entity.migrationQueryId, sourceTable: entity.sourceTable },
        ),
      );
      continue;
    }

    if (
      query.sourceTable !== entity.sourceTable ||
      query.expectedSourceRows !== entity.baselineCount ||
      query.expectedRowOutcomes !== entity.expectedRowOutcomes ||
      query.transformVersion !== entity.transformVersion ||
      query.countSql === undefined ||
      query.extractionSql === undefined ||
      query.extractionSqlSha256 === undefined
    ) {
      issues.push(
        issue(
          "MANIFEST_QUERY_MISMATCH",
          "registry",
          "Manifest entity and source_extract query disagree",
          "Regenerate manifest and query registry from the same source-field and scope contracts",
          { queryId: entity.migrationQueryId, sourceTable: entity.sourceTable },
        ),
      );
    }
  }
}

function validateManifestDispositions(registries: MigrationRegistryBundle, issues: MigrationIssue[]): void {
  const dispositionByTable = new Map(
    registries.dispositions.map((disposition) => [disposition.sourceTable, disposition]),
  );

  for (const entity of registries.manifest.entities) {
    const disposition = dispositionByTable.get(entity.sourceTable);
    if (
      disposition === undefined ||
      disposition.disposition !== entity.sourceDisposition ||
      disposition.rows !== entity.baselineCount ||
      disposition.expectedRowOutcomes !== entity.expectedRowOutcomes ||
      disposition.migrationQueryId !== entity.migrationQueryId ||
      disposition.transformVersion !== entity.transformVersion
    ) {
      issues.push(
        issue(
          "MANIFEST_DISPOSITION_MISMATCH",
          "registry",
          "Manifest entity and source-table disposition disagree",
          "Regenerate the manifest and disposition registry from one scope decision",
          { sourceTable: entity.sourceTable },
        ),
      );
    }
  }
}

function validateDenominators(
  registries: MigrationRegistryBundle,
  issues: MigrationIssue[],
): Readonly<{ dispositionRows: number; manifestRows: number }> {
  const manifestRows = registries.manifest.entities.reduce(
    (total, entity) => total + entity.expectedRowOutcomes,
    0,
  );
  if (manifestRows !== registries.manifest.rowOutcomeDenominator) {
    issues.push(
      issue(
        "MANIFEST_DENOMINATOR_INVALID",
        "registry",
        "Manifest coverage denominator differs from its entity outcomes",
        "Recalculate row_outcome_contract.coverage_denominator from manifest entities",
        {
          entityOutcomeRows: manifestRows,
          manifestDenominator: registries.manifest.rowOutcomeDenominator,
        },
      ),
    );
  }

  const dispositionsInScope = registries.dispositions.filter(
    (disposition) =>
      disposition.disposition === "include_row_ledger" || disposition.disposition === "quarantine_only",
  );
  const dispositionRows = sumRows(dispositionsInScope);
  if (dispositionRows !== registries.manifest.rowOutcomeDenominator) {
    issues.push(
      issue(
        "REGISTRY_DENOMINATOR_DRIFT",
        "registry",
        "Disposition registry migration rows differ from the manifest ledger denominator",
        "Add missing quarantined records to the row ledger or version an equally atomic decision ledger",
        {
          delta: dispositionRows - registries.manifest.rowOutcomeDenominator,
          dispositionRows,
          manifestDenominator: registries.manifest.rowOutcomeDenominator,
        },
      ),
    );
  }

  return { dispositionRows, manifestRows };
}

function validateKnownRegistryBlockers(registries: MigrationRegistryBundle, issues: MigrationIssue[]): void {
  const leadDisposition = findDisposition(registries, "b_crm_lead");
  const leadManifestEntity = registries.manifest.entities.find(
    (entity) => entity.sourceTable === "b_crm_lead",
  );
  if (
    leadDisposition !== undefined &&
    leadDisposition.rows > 0 &&
    (leadManifestEntity === undefined || leadDisposition.disposition !== "include_row_ledger")
  ) {
    issues.push(
      issue(
        "LEGACY_LEADS_REQUIRE_SIGNED_OUTCOMES",
        "business-decision",
        "Legacy CRM leads are outside the row ledger despite requiring classification",
        "Add b_crm_lead to the manifest or record a signed exclusion outcome for every lead",
        { disposition: leadDisposition.disposition, rows: leadDisposition.rows },
      ),
    );
  }

  const externalLinkDisposition = findDisposition(registries, "b_disk_external_link");
  const externalLinkManifestEntity = registries.manifest.entities.find(
    (entity) => entity.sourceTable === "b_disk_external_link",
  );
  if (
    externalLinkDisposition !== undefined &&
    externalLinkDisposition.rows > 0 &&
    externalLinkManifestEntity === undefined
  ) {
    issues.push(
      issue(
        "EXTERNAL_LINK_DECISIONS_NOT_LEDGERED",
        "security",
        "Legacy external links require revoke, reissue, or signed exclusion outcomes outside the row ledger",
        "Include external-link security decisions in the atomic migration ledger without copying legacy secrets",
        {
          fileAclContractRows: registries.manifest.externalLinkBaselineRows,
          rows: externalLinkDisposition.rows,
        },
      ),
    );
  }
}

function validateDump(
  registries: MigrationRegistryBundle,
  dump: LegacyDumpInspection | null,
  issues: MigrationIssue[],
): void {
  if (dump === null) {
    issues.push(
      issue(
        "SOURCE_DUMP_NOT_INSPECTED",
        "source-snapshot",
        "No source dump was supplied for checksum and consistency inspection",
        "Pass the immutable .sql.gz path before any dry-run or import",
        { inspected: false },
      ),
    );
    return;
  }

  if (dump.sha256 !== registries.manifest.snapshotSha256) {
    issues.push(
      issue(
        "DUMP_SHA256_MISMATCH",
        "source-snapshot",
        "Source dump checksum does not match the authoritative manifest",
        "Use the pinned immutable dump or regenerate all registries from the new snapshot",
        { actualSha256: dump.sha256, expectedSha256: registries.manifest.snapshotSha256 },
      ),
    );
  }

  if (dump.completedAt === null) {
    issues.push(
      issue(
        "DUMP_COMPLETION_MARKER_MISSING",
        "source-snapshot",
        "Source dump has no completion marker",
        "Reject the dump and produce a complete verified export",
        { completed: false },
      ),
    );
  }

  if (dump.lockTableStatements !== dump.unlockTableStatements) {
    issues.push(
      issue(
        "DUMP_LOCK_BALANCE_INVALID",
        "source-snapshot",
        "Source dump has unbalanced table lock markers",
        "Reject the dump and produce a complete verified export",
        { locks: dump.lockTableStatements, unlocks: dump.unlockTableStatements },
      ),
    );
  }

  const hasTransactionalSnapshot = dump.startTransactionStatements > 0 && dump.commitStatements > 0;
  const hasReplicationWatermark =
    dump.gtidMarkers > 0 || dump.masterLogMarkers > 0 || dump.changeMasterStatements > 0;
  if (!hasTransactionalSnapshot) {
    issues.push(
      issue(
        "SOURCE_SNAPSHOT_NOT_POINT_IN_TIME",
        "source-snapshot",
        "Dump contains per-table data without a global transactional snapshot",
        "Create a fresh InnoDB --single-transaction export and bind it to the file snapshot freeze watermark",
        {
          hasReplicationWatermark,
          lockStatements: dump.lockTableStatements,
          startTransactions: dump.startTransactionStatements,
        },
      ),
    );
  }

  if (registries.manifest.productionCutoverRequiresFreshSnapshot) {
    issues.push(
      issue(
        "FRESH_CUTOVER_SNAPSHOT_REQUIRED",
        "source-snapshot",
        "Authoritative manifest marks the current snapshot as non-final for production cutover",
        "Regenerate the snapshot, registries, and reconciliation evidence at the approved cutover watermark",
        { required: true },
        "warning",
      ),
    );
  }
}

export function runMigrationPreflight(
  registries: MigrationRegistryBundle,
  dump: LegacyDumpInspection | null,
  now: Date = new Date(),
): MigrationPreflightReport {
  const issues: MigrationIssue[] = [];
  validateRegistryIdentity(registries, issues);
  validateRegistryUniqueness(registries, issues);
  validateManifestQueries(registries, issues);
  validateManifestDispositions(registries, issues);
  const denominators = validateDenominators(registries, issues);
  validateKnownRegistryBlockers(registries, issues);
  validateDump(registries, dump, issues);
  issues.sort((left, right) => left.code.localeCompare(right.code));

  const blockingIssues = issues.filter((candidate) => candidate.severity === "blocking");
  const dryRunBlockingIssues = blockingIssues.filter((candidate) =>
    DRY_RUN_BLOCKING_CODES.has(candidate.code),
  );

  return {
    canDryRun: dryRunBlockingIssues.length === 0,
    canImport: blockingIssues.length === 0,
    dispositionRowsInMigrationScope: denominators.dispositionRows,
    dump,
    generatedAt: now.toISOString(),
    issues,
    manifestRowsInMigrationScope: denominators.manifestRows,
    registryDirectory: registries.registryDirectory,
    snapshotSha256: registries.manifest.snapshotSha256,
    sourceSystem: registries.manifest.sourceSystem,
  };
}
