import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { MigrationError } from "./errors.js";
import type {
  MigrationManifestEntity,
  MigrationRegistryBundle,
  MigrationRegistryQuery,
  SourceTableDisposition,
} from "./types.js";

const nonNegativeInteger = z.number().int().nonnegative();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

const sourceKeySchema = z
  .object({
    columns: z.array(z.string().min(1)).min(1),
    kind: z.enum(["primary_key", "unique_index"]),
  })
  .passthrough();

const projectionCountsSchema = z
  .object({
    would_conflict: nonNegativeInteger,
    would_exclude: nonNegativeInteger,
    would_migrate: nonNegativeInteger,
    would_quarantine: nonNegativeInteger,
  })
  .strict();

const manifestEntitySchema = z
  .object({
    baseline_count: nonNegativeInteger,
    depends_on: z.array(z.string().min(1)).optional(),
    dry_run_classifier: z
      .object({
        expected_projection_counts: projectionCountsSchema,
        id: z.string().min(1),
      })
      .passthrough()
      .optional(),
    expected_row_outcomes: nonNegativeInteger,
    migration_query_id: z.string().min(1),
    source_disposition: z.enum(["include_row_ledger", "quarantine_only"]),
    source_key: sourceKeySchema,
    source_table: z.string().min(1),
    target: z.array(z.string().min(1)),
    transform_version: z.string().min(1),
  })
  .passthrough();

const manifestSchema = z
  .object({
    entities: z.array(manifestEntitySchema).min(1),
    file_acl_contract: z
      .object({
        legacy_external_link_contract: z
          .object({
            baseline_rows: nonNegativeInteger,
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
    manifest_version: z.string().min(1),
    row_outcome_contract: z
      .object({
        allowed_outcomes: z.array(z.string().min(1)).min(1),
        coverage_denominator: nonNegativeInteger,
        ledger_key_components: z.array(z.string().min(1)).min(1),
      })
      .passthrough(),
    snapshot: z
      .object({
        file: z.string().min(1),
        production_cutover_requires_fresh_snapshot: z.boolean(),
        sha256: sha256Schema,
      })
      .passthrough(),
    source_system: z.string().min(1),
  })
  .passthrough();

const querySchema = z
  .object({
    count_sql: z.string().min(1).optional(),
    expected_row_outcomes: nonNegativeInteger.optional(),
    expected_source_rows: nonNegativeInteger.optional(),
    extraction_sql: z.string().min(1).optional(),
    extraction_sql_sha256: sha256Schema.optional(),
    query_id: z.string().min(1),
    query_kind: z.string().min(1),
    source_table: z.string().min(1).optional(),
    transform_version: z.string().min(1).optional(),
  })
  .passthrough();

const queryRegistrySchema = z
  .object({
    queries: z.array(querySchema).min(1),
    query_count: nonNegativeInteger,
    snapshot_sha256: sha256Schema,
  })
  .passthrough();

const sourceFieldMapSchema = z
  .object({
    snapshot_sha256: sha256Schema,
    source_system: z.string().min(1),
  })
  .passthrough();

const targetModelSchema = z
  .object({
    snapshot_sha256: sha256Schema,
  })
  .passthrough();

const dispositionHeader = [
  "source_table",
  "rows",
  "disposition",
  "reason_code",
  "domain_owner",
  "decision_status",
  "migration_query_id",
  "transform_version",
  "expected_row_outcomes",
] as const;

type ParsedJson = z.infer<typeof manifestSchema>;

async function readJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new MigrationError(
      "REGISTRY_FILE_UNREADABLE",
      `Required migration registry is unreadable: ${path}`,
      {
        cause: error,
      },
    );
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new MigrationError(
      "REGISTRY_JSON_INVALID",
      `Required migration registry is not valid JSON: ${path}`,
      {
        cause: error,
      },
    );
  }

  const parsed = schema.safeParse(decoded);
  if (!parsed.success) {
    throw new MigrationError(
      "REGISTRY_SCHEMA_INVALID",
      `Required migration registry does not satisfy its runtime contract: ${path}`,
    );
  }

  return parsed.data;
}

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let currentField = "";
  let currentRow: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === undefined) {
      continue;
    }

    if (inQuotes) {
      if (character === '"' && input[index + 1] === '"') {
        currentField += '"';
        index += 1;
      } else if (character === '"') {
        inQuotes = false;
      } else {
        currentField += character;
      }
      continue;
    }

    if (character === '"') {
      inQuotes = true;
    } else if (character === ",") {
      currentRow.push(currentField);
      currentField = "";
    } else if (character === "\n") {
      currentRow.push(currentField.replace(/\r$/u, ""));
      rows.push(currentRow);
      currentField = "";
      currentRow = [];
    } else {
      currentField += character;
    }
  }

  if (inQuotes) {
    throw new MigrationError("REGISTRY_CSV_INVALID", "Source disposition registry has an unterminated field");
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.replace(/\r$/u, ""));
    rows.push(currentRow);
  }

  return rows;
}

function parseInteger(value: string, field: string, sourceTable: string): number {
  if (!/^(0|[1-9]\d*)$/u.test(value)) {
    throw new MigrationError(
      "REGISTRY_CSV_INVALID",
      `Source disposition registry has invalid ${field} for table ${sourceTable}`,
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new MigrationError(
      "REGISTRY_CSV_INVALID",
      `Source disposition registry exceeds safe integer range for table ${sourceTable}`,
    );
  }
  return parsed;
}

function parseDispositions(raw: string): SourceTableDisposition[] {
  const rows = parseCsv(raw);
  const header = rows.shift();
  if (header === undefined || header.join("\u0000") !== dispositionHeader.join("\u0000")) {
    throw new MigrationError(
      "REGISTRY_CSV_INVALID",
      "Source disposition registry header is not authoritative",
    );
  }

  return rows.map((row) => {
    if (row.length !== dispositionHeader.length) {
      throw new MigrationError("REGISTRY_CSV_INVALID", "Source disposition registry row width is invalid");
    }

    const values = Object.fromEntries(dispositionHeader.map((name, index) => [name, row[index] ?? ""]));
    const sourceTable = values.source_table ?? "";
    const disposition = values.disposition;
    if (
      disposition !== "exclude_with_reason" &&
      disposition !== "include_row_ledger" &&
      disposition !== "quarantine_only"
    ) {
      throw new MigrationError(
        "REGISTRY_CSV_INVALID",
        `Source disposition registry has unsupported disposition for table ${sourceTable}`,
      );
    }

    return {
      decisionStatus: values.decision_status ?? "",
      disposition,
      expectedRowOutcomes: parseInteger(
        values.expected_row_outcomes ?? "",
        "expected_row_outcomes",
        sourceTable,
      ),
      migrationQueryId: values.migration_query_id ?? "",
      reasonCode: values.reason_code ?? "",
      rows: parseInteger(values.rows ?? "", "rows", sourceTable),
      sourceTable,
      transformVersion: values.transform_version ?? "",
    };
  });
}

function mapManifestEntity(entity: ParsedJson["entities"][number]): MigrationManifestEntity {
  return {
    baselineCount: entity.baseline_count,
    ...(entity.dry_run_classifier === undefined
      ? {}
      : {
          classifierId: entity.dry_run_classifier.id,
          expectedProjectionCounts: entity.dry_run_classifier.expected_projection_counts,
        }),
    dependsOn: entity.depends_on ?? [],
    expectedRowOutcomes: entity.expected_row_outcomes,
    migrationQueryId: entity.migration_query_id,
    sourceDisposition: entity.source_disposition,
    sourceKey: {
      columns: entity.source_key.columns,
      kind: entity.source_key.kind,
    },
    sourceTable: entity.source_table,
    targets: entity.target,
    transformVersion: entity.transform_version,
  };
}

function mapRegistryQuery(query: z.infer<typeof querySchema>): MigrationRegistryQuery {
  if (
    query.extraction_sql !== undefined &&
    query.extraction_sql_sha256 !== undefined &&
    createHash("sha256").update(query.extraction_sql).digest("hex") !== query.extraction_sql_sha256
  ) {
    throw new MigrationError(
      "REGISTRY_QUERY_CHECKSUM_MISMATCH",
      `Registered extraction query checksum differs for query ${query.query_id}`,
    );
  }

  return {
    ...(query.count_sql === undefined ? {} : { countSql: query.count_sql }),
    ...(query.expected_row_outcomes === undefined
      ? {}
      : { expectedRowOutcomes: query.expected_row_outcomes }),
    ...(query.expected_source_rows === undefined ? {} : { expectedSourceRows: query.expected_source_rows }),
    ...(query.extraction_sql === undefined ? {} : { extractionSql: query.extraction_sql }),
    ...(query.extraction_sql_sha256 === undefined
      ? {}
      : { extractionSqlSha256: query.extraction_sql_sha256 }),
    queryId: query.query_id,
    queryKind: query.query_kind,
    ...(query.source_table === undefined ? {} : { sourceTable: query.source_table }),
    ...(query.transform_version === undefined ? {} : { transformVersion: query.transform_version }),
  };
}

export async function loadMigrationRegistries(registryDirectory: string): Promise<MigrationRegistryBundle> {
  const directory = resolve(registryDirectory);
  const manifestPath = resolve(directory, "migration-scope-manifest.json");
  const queryRegistryPath = resolve(directory, "migration-query-registry.json");
  const sourceFieldMapPath = resolve(directory, "source-field-map.json");
  const targetModelPath = resolve(directory, "target-model-registry.json");
  const dispositionsPath = resolve(directory, "source-table-dispositions.csv");

  const [manifest, queryRegistry, sourceFieldMap, targetModel, dispositionsRaw] = await Promise.all([
    readJson(manifestPath, manifestSchema),
    readJson(queryRegistryPath, queryRegistrySchema),
    readJson(sourceFieldMapPath, sourceFieldMapSchema),
    readJson(targetModelPath, targetModelSchema),
    readFile(dispositionsPath, "utf8").catch((error: unknown) => {
      throw new MigrationError(
        "REGISTRY_FILE_UNREADABLE",
        `Required migration registry is unreadable: ${dispositionsPath}`,
        { cause: error },
      );
    }),
  ]);

  return {
    declaredQueryCount: queryRegistry.query_count,
    dispositions: parseDispositions(dispositionsRaw),
    manifest: {
      entities: manifest.entities.map(mapManifestEntity),
      externalLinkBaselineRows: manifest.file_acl_contract?.legacy_external_link_contract?.baseline_rows ?? 0,
      fileName: manifest.snapshot.file,
      ledgerKeyComponents: manifest.row_outcome_contract.ledger_key_components,
      ledgerOutcomes: manifest.row_outcome_contract.allowed_outcomes,
      manifestVersion: manifest.manifest_version,
      productionCutoverRequiresFreshSnapshot: manifest.snapshot.production_cutover_requires_fresh_snapshot,
      rowOutcomeDenominator: manifest.row_outcome_contract.coverage_denominator,
      snapshotSha256: manifest.snapshot.sha256,
      sourceSystem: manifest.source_system,
    },
    queries: queryRegistry.queries.map(mapRegistryQuery),
    queryRegistrySha256: queryRegistry.snapshot_sha256,
    registryDirectory: directory,
    sourceFieldMapSha256: sourceFieldMap.snapshot_sha256,
    sourceFieldMapSourceSystem: sourceFieldMap.source_system,
    targetModelSha256: targetModel.snapshot_sha256,
  };
}
