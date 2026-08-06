import {
  CANONICAL_TRANSFORM_REGISTRY_VERSION,
  getCanonicalTransformContract,
} from "./canonical-transform-registry.js";
import { MigrationError } from "./errors.js";
import type {
  MigrationManifestEntity,
  MigrationPlan,
  MigrationPlanItem,
  MigrationPreflightReport,
  MigrationProjection,
  MigrationRegistryBundle,
} from "./types.js";
import { EXPECTED_SOURCE_SYSTEM, MIGRATION_PROJECTIONS } from "./types.js";

function emptyProjectionCounts(): Record<MigrationProjection, number> {
  return {
    would_conflict: 0,
    would_exclude: 0,
    would_migrate: 0,
    would_quarantine: 0,
  };
}

function fallbackProjectionCounts(expectedRows: number): Readonly<Record<MigrationProjection, number>> {
  return {
    would_conflict: 0,
    would_exclude: 0,
    would_migrate: 0,
    would_quarantine: expectedRows,
  };
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameProjectionCounts(
  left: Readonly<Record<MigrationProjection, number>>,
  right: Readonly<Record<MigrationProjection, number>>,
): boolean {
  return MIGRATION_PROJECTIONS.every((projection) => left[projection] === right[projection]);
}

function resolveClassifierContract(
  entity: MigrationManifestEntity,
): Pick<MigrationPlanItem, "classifierId" | "dependsOn" | "expectedProjectionCounts" | "validationRules"> {
  const contract = getCanonicalTransformContract(entity.sourceTable, entity.transformVersion);
  if (contract === undefined) {
    if (entity.classifierId !== undefined || entity.expectedProjectionCounts !== undefined) {
      throw new MigrationError(
        "CANONICAL_TRANSFORM_REGISTRY_MISMATCH",
        `Manifest declares an unavailable canonical transform for ${entity.sourceTable}`,
      );
    }
    return {
      classifierId:
        entity.sourceDisposition === "quarantine_only"
          ? "source-table-quarantine-only-v1"
          : "unregistered-transform-quarantine-v1",
      dependsOn: entity.dependsOn,
      expectedProjectionCounts: fallbackProjectionCounts(entity.expectedRowOutcomes),
      validationRules: ["canonical transform is not registered; every row remains quarantined"],
    };
  }

  if (
    entity.classifierId !== contract.classifierId ||
    entity.expectedProjectionCounts === undefined ||
    !sameProjectionCounts(entity.expectedProjectionCounts, contract.expectedProjectionCounts) ||
    !sameStrings(entity.dependsOn, contract.dependsOn)
  ) {
    throw new MigrationError(
      "CANONICAL_TRANSFORM_REGISTRY_MISMATCH",
      `Manifest and executable canonical transform differ for ${entity.sourceTable}`,
    );
  }

  return {
    classifierId: contract.classifierId,
    dependsOn: contract.dependsOn,
    expectedProjectionCounts: contract.expectedProjectionCounts,
    validationRules: contract.validationRules,
  };
}

function assertProjectionBalance(item: MigrationPlanItem): void {
  const classifiedRows = MIGRATION_PROJECTIONS.reduce(
    (total, projection) => total + item.expectedProjectionCounts[projection],
    0,
  );
  if (classifiedRows !== item.expectedRows) {
    throw new MigrationError(
      "MIGRATION_CLASSIFIER_COUNT_INVALID",
      `Expected projection counts do not balance for ${item.sourceTable}`,
    );
  }
}

function sortPlanItems(items: readonly MigrationPlanItem[]): MigrationPlanItem[] {
  const itemByTable = new Map(items.map((item) => [item.sourceTable, item] as const));
  const originalIndex = new Map(items.map((item, index) => [item.sourceTable, index] as const));
  const dependents = new Map<string, string[]>();
  const indegree = new Map<string, number>();

  for (const item of items) {
    indegree.set(item.sourceTable, item.dependsOn.length);
    for (const dependency of item.dependsOn) {
      if (!itemByTable.has(dependency) || dependency === item.sourceTable) {
        throw new MigrationError(
          "MIGRATION_DEPENDENCY_INVALID",
          `Migration dependency ${dependency} is invalid for ${item.sourceTable}`,
        );
      }
      const children = dependents.get(dependency) ?? [];
      children.push(item.sourceTable);
      dependents.set(dependency, children);
    }
  }

  const priority = (table: string): number => {
    const item = itemByTable.get(table);
    const index = originalIndex.get(table) ?? items.length;
    if (item === undefined) {
      return 10_000 + index;
    }
    return (
      getCanonicalTransformContract(item.sourceTable, item.transformVersion)?.executionOrder ?? 1_000 + index
    );
  };
  const ready = items
    .filter((item) => indegree.get(item.sourceTable) === 0)
    .map((item) => item.sourceTable)
    .sort((left, right) => priority(left) - priority(right));
  const ordered: MigrationPlanItem[] = [];

  while (ready.length > 0) {
    const sourceTable = ready.shift();
    if (sourceTable === undefined) {
      break;
    }
    const item = itemByTable.get(sourceTable);
    if (item === undefined) {
      throw new MigrationError("MIGRATION_DEPENDENCY_INVALID", "Migration dependency graph lost an item");
    }
    ordered.push(item);
    for (const dependent of dependents.get(sourceTable) ?? []) {
      const nextIndegree = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, nextIndegree);
      if (nextIndegree === 0) {
        ready.push(dependent);
        ready.sort((left, right) => priority(left) - priority(right));
      }
    }
  }

  if (ordered.length !== items.length) {
    throw new MigrationError("MIGRATION_DEPENDENCY_CYCLE", "Migration dependency graph contains a cycle");
  }
  return ordered;
}

export function buildMigrationPlan(
  registries: MigrationRegistryBundle,
  preflight: MigrationPreflightReport,
  now: Date = new Date(),
): MigrationPlan {
  if (registries.manifest.sourceSystem !== EXPECTED_SOURCE_SYSTEM) {
    throw new MigrationError(
      "SOURCE_SYSTEM_MISMATCH",
      `Migration backend only accepts source_system=${EXPECTED_SOURCE_SYSTEM}`,
    );
  }

  const queryById = new Map(registries.queries.map((query) => [query.queryId, query]));
  const unsortedItems = registries.manifest.entities.map((entity): MigrationPlanItem => {
    const query = queryById.get(entity.migrationQueryId);
    if (query?.countSql === undefined || query.extractionSql === undefined) {
      throw new MigrationError(
        "MANIFEST_QUERY_MISSING",
        `No executable source query is registered for table ${entity.sourceTable}`,
      );
    }
    if (query.sourceTable !== entity.sourceTable || query.transformVersion !== entity.transformVersion) {
      throw new MigrationError(
        "MANIFEST_QUERY_MISMATCH",
        `Manifest and source query identity differ for table ${entity.sourceTable}`,
      );
    }

    const classifier = resolveClassifierContract(entity);
    const item: MigrationPlanItem = {
      ...classifier,
      countSql: query.countSql,
      expectedRows: entity.expectedRowOutcomes,
      extractionSql: query.extractionSql,
      queryId: entity.migrationQueryId,
      sourceDisposition: entity.sourceDisposition,
      sourceKey: entity.sourceKey,
      sourceTable: entity.sourceTable,
      targets: entity.targets,
      transformVersion: entity.transformVersion,
    };
    assertProjectionBalance(item);
    return item;
  });
  const items = sortPlanItems(unsortedItems);
  const totalExpectedProjectionCounts = emptyProjectionCounts();
  for (const item of items) {
    for (const projection of MIGRATION_PROJECTIONS) {
      totalExpectedProjectionCounts[projection] += item.expectedProjectionCounts[projection];
    }
  }

  return {
    adapterRequirement: "mysql2 read-only source plus append-only PostgreSQL attempt ledger",
    blockerCodes: preflight.issues
      .filter((candidate) => candidate.severity === "blocking")
      .map((candidate) => candidate.code),
    generatedAt: now.toISOString(),
    items,
    manifestVersion: registries.manifest.manifestVersion,
    snapshotSha256: registries.manifest.snapshotSha256,
    sourceSystem: EXPECTED_SOURCE_SYSTEM,
    totalExpectedProjectionCounts,
    totalExpectedRows: items.reduce((total, item) => total + item.expectedRows, 0),
    transformRegistryVersion: CANONICAL_TRANSFORM_REGISTRY_VERSION,
  };
}

export function toSafeMigrationPlan(plan: MigrationPlan): Readonly<Record<string, unknown>> {
  return {
    adapterRequirement: plan.adapterRequirement,
    blockerCodes: plan.blockerCodes,
    generatedAt: plan.generatedAt,
    items: plan.items.map((item, executionIndex) => ({
      classifierId: item.classifierId,
      dependsOn: item.dependsOn,
      executionIndex,
      expectedProjectionCounts: item.expectedProjectionCounts,
      expectedRows: item.expectedRows,
      queryId: item.queryId,
      sourceDisposition: item.sourceDisposition,
      sourceKeyColumns: item.sourceKey.columns,
      sourceKeyKind: item.sourceKey.kind,
      sourceTable: item.sourceTable,
      targets: item.targets,
      transformVersion: item.transformVersion,
      validationRules: item.validationRules,
    })),
    manifestVersion: plan.manifestVersion,
    snapshotSha256: plan.snapshotSha256,
    sourceSystem: plan.sourceSystem,
    totalExpectedProjectionCounts: plan.totalExpectedProjectionCounts,
    totalExpectedRows: plan.totalExpectedRows,
    transformRegistryVersion: plan.transformRegistryVersion,
  };
}
