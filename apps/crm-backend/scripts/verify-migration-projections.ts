#!/usr/bin/env node

import { resolve } from "node:path";
import type { MigrationProjection } from "../src/modules/migration/index.js";
import {
  buildMigrationPlan,
  CanonicalDryRunClassifier,
  getCanonicalTransformContract,
  inspectLegacyDump,
  loadMigrationRegistries,
  MIGRATION_PROJECTIONS,
  MigrationError,
  MysqlLegacySource,
  runMigrationPreflight,
  toSafeMigrationError,
} from "../src/modules/migration/index.js";

function emptyCounts(): Record<MigrationProjection, number> {
  return {
    would_conflict: 0,
    would_exclude: 0,
    would_migrate: 0,
    would_quarantine: 0,
  };
}

function sameCounts(
  actual: Readonly<Record<MigrationProjection, number>>,
  expected: Readonly<Record<MigrationProjection, number>>,
): boolean {
  return MIGRATION_PROJECTIONS.every((projection) => actual[projection] === expected[projection]);
}

async function main(): Promise<void> {
  const cwd = process.cwd();
  const registryDirectory = resolve(
    cwd,
    process.env.CRM_MIGRATION_REGISTRY_PATH ?? "../../docs/cabinet/generated",
  );
  const dumpPath = resolve(cwd, process.env.CRM_MIGRATION_DUMP_PATH ?? "../../sitemanager-final.sql.gz");
  const connectionUrl = process.env.LEGACY_MYSQL_URL;
  if (!connectionUrl) {
    throw new MigrationError(
      "LEGACY_MYSQL_URL_REQUIRED",
      "LEGACY_MYSQL_URL is required for projection verification",
    );
  }

  const registries = await loadMigrationRegistries(registryDirectory);
  const preflight = runMigrationPreflight(registries, await inspectLegacyDump(dumpPath));
  if (!preflight.canDryRun) {
    throw new MigrationError(
      "DRY_RUN_PREFLIGHT_BLOCKED",
      "Projection verification is blocked by registry integrity",
    );
  }
  const plan = buildMigrationPlan(registries, preflight);
  const items = plan.items.filter(
    (item) => getCanonicalTransformContract(item.sourceTable, item.transformVersion) !== undefined,
  );
  const source = new MysqlLegacySource({
    connectionUrl,
    snapshotSha256: plan.snapshotSha256,
    sourceSystem: plan.sourceSystem,
  });
  const classifier = new CanonicalDryRunClassifier();
  const projectionCounts = emptyCounts();
  const tableResults: Array<Readonly<Record<string, unknown>>> = [];
  let processedRows = 0;

  try {
    for (const item of items) {
      const sourceRows = await source.countRows(item);
      if (sourceRows !== item.expectedRows) {
        throw new MigrationError(
          "SOURCE_COUNT_MISMATCH",
          `Projection verification source count drifted for ${item.sourceTable}`,
        );
      }
      const counts = emptyCounts();
      let streamedRows = 0;
      for await (const row of source.streamRows(item)) {
        const result = await classifier.classify(item, row);
        counts[result.projection] += 1;
        streamedRows += 1;
      }
      if (streamedRows !== item.expectedRows || !sameCounts(counts, item.expectedProjectionCounts)) {
        throw new MigrationError(
          "MIGRATION_CLASSIFIER_COUNT_MISMATCH",
          `Projection verification drifted for ${item.sourceTable}`,
        );
      }
      for (const projection of MIGRATION_PROJECTIONS) {
        projectionCounts[projection] += counts[projection];
      }
      processedRows += streamedRows;
      tableResults.push({
        classifierId: item.classifierId,
        projectionCounts: counts,
        sourceRows,
        sourceTable: item.sourceTable,
        transformVersion: item.transformVersion,
      });
    }
  } finally {
    await source.close();
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        canImport: preflight.canImport,
        mode: "projection-verification",
        planExpectedProjectionCounts: plan.totalExpectedProjectionCounts,
        processedRows,
        projectionCounts,
        snapshotSha256: plan.snapshotSha256,
        status: "PROJECTIONS_VERIFIED",
        tables: tableResults,
        transformRegistryVersion: plan.transformRegistryVersion,
      },
      null,
      2,
    )}\n`,
  );
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify(toSafeMigrationError(error))}\n`);
  process.exitCode = 1;
}
