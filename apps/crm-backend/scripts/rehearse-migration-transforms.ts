#!/usr/bin/env node

import { resolve } from "node:path";
import type { MigrationPlan, MigrationProjection } from "../src/modules/migration/index.js";
import {
  buildMigrationPlan,
  CanonicalDryRunClassifier,
  executeMigration,
  getCanonicalTransformContract,
  inspectLegacyDump,
  loadMigrationRegistries,
  MIGRATION_PROJECTIONS,
  MigrationError,
  MysqlLegacySource,
  PostgresMigrationUnitOfWork,
  runMigrationPreflight,
  toSafeMigrationError,
} from "../src/modules/migration/index.js";

function boundedPlan(plan: MigrationPlan): MigrationPlan {
  const items = plan.items.filter(
    (item) => getCanonicalTransformContract(item.sourceTable, item.transformVersion) !== undefined,
  );
  const totalExpectedProjectionCounts: Record<MigrationProjection, number> = {
    would_conflict: 0,
    would_exclude: 0,
    would_migrate: 0,
    would_quarantine: 0,
  };
  for (const item of items) {
    for (const projection of MIGRATION_PROJECTIONS) {
      totalExpectedProjectionCounts[projection] += item.expectedProjectionCounts[projection];
    }
  }
  return {
    ...plan,
    items,
    totalExpectedProjectionCounts,
    totalExpectedRows: items.reduce((total, item) => total + item.expectedRows, 0),
  };
}

async function main(): Promise<void> {
  if (process.env.MIGRATION_REHEARSAL_APPROVED !== "true") {
    throw new MigrationError(
      "MIGRATION_REHEARSAL_APPROVAL_REQUIRED",
      "Set MIGRATION_REHEARSAL_APPROVED=true only for an approved isolated dry-run ledger rehearsal",
    );
  }
  const legacyMysqlUrl = process.env.LEGACY_MYSQL_URL;
  const databaseUrl = process.env.DATABASE_URL;
  if (!legacyMysqlUrl || !databaseUrl) {
    throw new MigrationError(
      "MIGRATION_CONNECTION_CONFIG_REQUIRED",
      "Transform rehearsal requires both LEGACY_MYSQL_URL and DATABASE_URL",
    );
  }

  const cwd = process.cwd();
  const registryDirectory = resolve(
    cwd,
    process.env.CRM_MIGRATION_REGISTRY_PATH ?? "../../docs/cabinet/generated",
  );
  const dumpPath = resolve(cwd, process.env.CRM_MIGRATION_DUMP_PATH ?? "../../sitemanager-final.sql.gz");
  const registries = await loadMigrationRegistries(registryDirectory);
  const preflight = runMigrationPreflight(registries, await inspectLegacyDump(dumpPath));
  if (!preflight.canDryRun) {
    throw new MigrationError(
      "DRY_RUN_PREFLIGHT_BLOCKED",
      "Transform rehearsal is blocked by registry integrity",
    );
  }
  const plan = boundedPlan(buildMigrationPlan(registries, preflight));
  const source = new MysqlLegacySource({
    connectionUrl: legacyMysqlUrl,
    snapshotSha256: plan.snapshotSha256,
    sourceSystem: plan.sourceSystem,
  });
  const unitOfWork = new PostgresMigrationUnitOfWork({ databaseUrl });
  try {
    const summary = await executeMigration({
      classifier: new CanonicalDryRunClassifier(),
      mode: "dry-run",
      plan,
      preflight,
      source,
      unitOfWork,
      writeConcurrency: Number(process.env.MIGRATION_WRITE_CONCURRENCY ?? 10),
    });
    process.stdout.write(
      `${JSON.stringify(
        {
          canImport: preflight.canImport,
          canonicalTargetWrites: 0,
          scope: "registered-transforms-only",
          snapshotSha256: plan.snapshotSha256,
          status: "TRANSFORM_REHEARSAL_COMPLETED",
          summary,
          transformRegistryVersion: plan.transformRegistryVersion,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await Promise.allSettled([source.close(), unitOfWork.close()]);
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify(toSafeMigrationError(error))}\n`);
  process.exitCode = 1;
}
