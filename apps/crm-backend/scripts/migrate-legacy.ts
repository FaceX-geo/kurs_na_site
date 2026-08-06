#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { MigrationRunMode } from "../src/modules/migration/index.js";
import {
  buildMigrationPlan,
  CanonicalDryRunClassifier,
  executeMigration,
  inspectLegacyDump,
  loadMigrationRegistries,
  MigrationError,
  MysqlLegacySource,
  PostgresMigrationUnitOfWork,
  runMigrationPreflight,
  toSafeMigrationError,
  toSafeMigrationPlan,
} from "../src/modules/migration/index.js";

export type MigrationCliCommand = "plan" | "preflight" | "run";

export interface MigrationCliOptions {
  readonly command: MigrationCliCommand;
  readonly dumpPath: string;
  readonly mode: MigrationRunMode;
  readonly registryDirectory: string;
}

function requireValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new MigrationError("CLI_ARGUMENT_INVALID", `Option ${option} requires a value`);
  }
  return value;
}

export function parseMigrationCliArgs(
  args: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): MigrationCliOptions {
  const command = args[0];
  if (command !== "preflight" && command !== "plan" && command !== "run") {
    throw new MigrationError(
      "CLI_ARGUMENT_INVALID",
      "Usage: migrate-legacy.ts <preflight|plan|run> [--registries PATH] [--dump PATH] [--mode dry-run|import]",
    );
  }

  let registryDirectory = resolve(
    cwd,
    environment.CRM_MIGRATION_REGISTRY_PATH ?? "../../docs/cabinet/generated",
  );
  let dumpPath = resolve(cwd, environment.CRM_MIGRATION_DUMP_PATH ?? "../../sitemanager-final.sql.gz");
  let mode: MigrationRunMode = "dry-run";

  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--registries") {
      registryDirectory = resolve(cwd, requireValue(args, index, argument));
      index += 1;
    } else if (argument === "--dump") {
      dumpPath = resolve(cwd, requireValue(args, index, argument));
      index += 1;
    } else if (argument === "--mode") {
      const value = requireValue(args, index, argument);
      if (value !== "dry-run" && value !== "import") {
        throw new MigrationError("CLI_ARGUMENT_INVALID", "Option --mode must be dry-run or import");
      }
      mode = value;
      index += 1;
    } else {
      throw new MigrationError("CLI_ARGUMENT_INVALID", `Unsupported migration CLI argument: ${argument}`);
    }
  }

  return { command, dumpPath, mode, registryDirectory };
}

function safePreflightOutput(
  report: Awaited<ReturnType<typeof runMigrationPreflight>>,
): Record<string, unknown> {
  return {
    canDryRun: report.canDryRun,
    canImport: report.canImport,
    dispositionRowsInMigrationScope: report.dispositionRowsInMigrationScope,
    dump:
      report.dump === null
        ? null
        : {
            completedAt: report.dump.completedAt,
            compressedBytes: report.dump.compressedBytes,
            lockTableStatements: report.dump.lockTableStatements,
            sha256: report.dump.sha256,
            startTransactionStatements: report.dump.startTransactionStatements,
            unlockTableStatements: report.dump.unlockTableStatements,
          },
    generatedAt: report.generatedAt,
    issues: report.issues,
    manifestRowsInMigrationScope: report.manifestRowsInMigrationScope,
    registryDirectory: report.registryDirectory,
    snapshotSha256: report.snapshotSha256,
    sourceSystem: report.sourceSystem,
  };
}

export async function runMigrationCli(
  args: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): Promise<number> {
  const options = parseMigrationCliArgs(args, environment, cwd);
  const registries = await loadMigrationRegistries(options.registryDirectory);
  const dump = await inspectLegacyDump(options.dumpPath);
  const preflight = runMigrationPreflight(registries, dump);

  if (options.command === "preflight") {
    process.stdout.write(`${JSON.stringify(safePreflightOutput(preflight), null, 2)}\n`);
    return preflight.canImport ? 0 : 2;
  }

  const plan = buildMigrationPlan(registries, preflight);
  if (options.command === "plan") {
    process.stdout.write(
      `${JSON.stringify({ plan: toSafeMigrationPlan(plan), preflight: safePreflightOutput(preflight) }, null, 2)}\n`,
    );
    return preflight.canDryRun ? 0 : 2;
  }

  if (options.mode === "import") {
    if (!preflight.canImport) {
      throw new MigrationError(
        "IMPORT_PREFLIGHT_BLOCKED",
        `Import is blocked by: ${plan.blockerCodes.join(", ")}`,
      );
    }
    throw new MigrationError(
      "IMPORT_CANONICAL_TRANSFORMS_REQUIRED",
      "Import remains disabled until every planned table has a verified canonical transactional transform",
    );
  }

  const legacyMysqlUrl = environment.LEGACY_MYSQL_URL;
  const databaseUrl = environment.DATABASE_URL;
  if (!legacyMysqlUrl || !databaseUrl) {
    throw new MigrationError(
      "MIGRATION_CONNECTION_CONFIG_REQUIRED",
      "A real dry-run requires both LEGACY_MYSQL_URL and DATABASE_URL",
    );
  }

  const source = new MysqlLegacySource({
    connectionUrl: legacyMysqlUrl,
    snapshotSha256: plan.snapshotSha256,
    sourceSystem: plan.sourceSystem,
  });
  const unitOfWork = new PostgresMigrationUnitOfWork({ databaseUrl });
  let executionError: unknown;
  let summary: Awaited<ReturnType<typeof executeMigration>> | undefined;
  try {
    summary = await executeMigration({
      classifier: new CanonicalDryRunClassifier(),
      mode: "dry-run",
      plan,
      preflight,
      source,
      unitOfWork,
      writeConcurrency: Number(environment.MIGRATION_WRITE_CONCURRENCY ?? 10),
    });
  } catch (error) {
    executionError = error;
  }

  const closeResults = await Promise.allSettled([source.close(), unitOfWork.close()]);
  if (executionError !== undefined) {
    throw executionError;
  }
  if (closeResults.some((result) => result.status === "rejected")) {
    throw new MigrationError(
      "MIGRATION_ADAPTER_CLOSE_FAILED",
      "Migration completed but a database adapter did not close cleanly",
    );
  }
  if (summary === undefined) {
    throw new MigrationError("MIGRATION_EXECUTION_FAILED", "Migration dry-run did not produce a summary");
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        mode: "dry-run",
        preflight: safePreflightOutput(preflight),
        status: "DRY_RUN_COMPLETED",
        summary,
      },
      null,
      2,
    )}\n`,
  );
  return 0;
}

async function main(): Promise<void> {
  try {
    process.exitCode = await runMigrationCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${JSON.stringify(toSafeMigrationError(error))}\n`);
    process.exitCode = error instanceof MigrationError && error.code === "CLI_ARGUMENT_INVALID" ? 64 : 1;
  }
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && resolve(entrypoint) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
