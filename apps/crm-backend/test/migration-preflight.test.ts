import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseMigrationCliArgs, runMigrationCli } from "../scripts/migrate-legacy.js";
import {
  buildMigrationPlan,
  inspectLegacyDump,
  loadMigrationRegistries,
  runMigrationPreflight,
  toSafeMigrationPlan,
} from "../src/modules/migration/index.js";

const temporaryDirectories: string[] = [];

interface FixtureOptions {
  readonly includeKnownBlockers?: boolean;
  readonly transactionalDump?: boolean;
}

interface Fixture {
  readonly dumpPath: string;
  readonly registryDirectory: string;
  readonly root: string;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function csvRow(values: readonly (number | string)[]): string {
  return values.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",");
}

async function createFixture(options: FixtureOptions = {}): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "crm-migration-test-"));
  temporaryDirectories.push(root);
  const registryDirectory = join(root, "registries");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(registryDirectory));

  const transactional = options.transactionalDump ?? true;
  const dumpSql = [
    "-- MySQL dump 10.13",
    transactional ? "START TRANSACTION /*!40100 WITH CONSISTENT SNAPSHOT */;" : "",
    "LOCK TABLES `b_crm_contact` WRITE;",
    "UNLOCK TABLES;",
    transactional ? "COMMIT;" : "",
    "-- Dump completed on 2026-08-06 10:00:00",
    "",
  ].join("\n");
  const dump = gzipSync(dumpSql);
  const dumpPath = join(root, "legacy.sql.gz");
  await writeFile(dumpPath, dump);
  const sha256 = createHash("sha256").update(dump).digest("hex");

  const manifest = {
    entities: [
      {
        baseline_count: 5,
        expected_row_outcomes: 5,
        migration_query_id: "MIG-Q-CONTACTS-V1",
        source_disposition: "include_row_ledger",
        source_key: { columns: ["ID"], kind: "primary_key" },
        source_table: "b_crm_contact",
        target: ["crm.crm_profile"],
        transform_version: "contact-v1",
      },
    ],
    file_acl_contract: {
      legacy_external_link_contract: {
        baseline_rows: options.includeKnownBlockers ? 2 : 0,
      },
    },
    manifest_version: "test-v1",
    row_outcome_contract: {
      allowed_outcomes: [
        "migrated",
        "linked_existing",
        "excluded_with_reason",
        "conflict_recorded",
        "quarantined",
      ],
      coverage_denominator: 5,
      ledger_key_components: [
        "snapshot_sha256",
        "source_table",
        "canonical_json(source_key)",
        "transform_version",
      ],
    },
    snapshot: {
      file: "legacy.sql.gz",
      production_cutover_requires_fresh_snapshot: false,
      sha256,
    },
    source_system: "bitrix",
  };
  const extractionSql = "SELECT `ID` FROM `b_crm_contact` ORDER BY `ID`";
  const queryRegistry = {
    queries: [
      {
        count_sql: "SELECT COUNT(*) AS source_rows FROM `b_crm_contact`",
        expected_row_outcomes: 5,
        expected_source_rows: 5,
        extraction_sql: extractionSql,
        extraction_sql_sha256: createHash("sha256").update(extractionSql).digest("hex"),
        query_id: "MIG-Q-CONTACTS-V1",
        query_kind: "source_extract",
        source_table: "b_crm_contact",
        transform_version: "contact-v1",
      },
    ],
    query_count: 1,
    snapshot_sha256: sha256,
  };

  await Promise.all([
    writeJson(join(registryDirectory, "migration-scope-manifest.json"), manifest),
    writeJson(join(registryDirectory, "migration-query-registry.json"), queryRegistry),
    writeJson(join(registryDirectory, "source-field-map.json"), {
      snapshot_sha256: sha256,
      source_system: "bitrix",
    }),
    writeJson(join(registryDirectory, "target-model-registry.json"), { snapshot_sha256: sha256 }),
  ]);

  const rows = [
    csvRow([
      "source_table",
      "rows",
      "disposition",
      "reason_code",
      "domain_owner",
      "decision_status",
      "migration_query_id",
      "transform_version",
      "expected_row_outcomes",
    ]),
    csvRow([
      "b_crm_contact",
      5,
      "include_row_ledger",
      "contract_scope",
      "migration_owner",
      "approved",
      "MIG-Q-CONTACTS-V1",
      "contact-v1",
      5,
    ]),
  ];
  if (options.includeKnownBlockers) {
    rows.push(
      csvRow([
        "b_crm_lead",
        7,
        "exclude_with_reason",
        "outside_contract_scope",
        "migration_owner",
        "requires_owner_confirmation",
        "N/A",
        "N/A",
        0,
      ]),
      csvRow([
        "b_disk_external_link",
        2,
        "quarantine_only",
        "security_decision_required",
        "security_owner",
        "pending_signed_decision",
        "N/A",
        "N/A",
        0,
      ]),
    );
  }
  await writeFile(join(registryDirectory, "source-table-dispositions.csv"), `${rows.join("\n")}\n`);

  return { dumpPath, registryDirectory, root };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("migration preflight", () => {
  it("detects leads, external links, denominator drift, and a non-transactional dump", async () => {
    const fixture = await createFixture({ includeKnownBlockers: true, transactionalDump: false });
    const registries = await loadMigrationRegistries(fixture.registryDirectory);
    const dump = await inspectLegacyDump(fixture.dumpPath);
    const report = runMigrationPreflight(registries, dump, new Date("2026-08-06T12:00:00Z"));
    const codes = new Set(report.issues.map((candidate) => candidate.code));

    expect(codes).toEqual(
      new Set([
        "EXTERNAL_LINK_DECISIONS_NOT_LEDGERED",
        "LEGACY_LEADS_REQUIRE_SIGNED_OUTCOMES",
        "REGISTRY_DENOMINATOR_DRIFT",
        "SOURCE_SNAPSHOT_NOT_POINT_IN_TIME",
      ]),
    );
    expect(report.canDryRun).toBe(true);
    expect(report.canImport).toBe(false);
    expect(report.dispositionRowsInMigrationScope).toBe(7);
    expect(report.manifestRowsInMigrationScope).toBe(5);
  });

  it("accepts a coherent transactional fixture and builds a safe plan", async () => {
    const fixture = await createFixture();
    const registries = await loadMigrationRegistries(fixture.registryDirectory);
    const report = runMigrationPreflight(registries, await inspectLegacyDump(fixture.dumpPath));
    const plan = buildMigrationPlan(registries, report, new Date("2026-08-06T12:00:00Z"));
    const safePlan = toSafeMigrationPlan(plan);

    expect(report.issues).toEqual([]);
    expect(report.canDryRun).toBe(true);
    expect(report.canImport).toBe(true);
    expect(plan.totalExpectedRows).toBe(5);
    expect(JSON.stringify(safePlan)).not.toContain("extractionSql");
    expect(JSON.stringify(safePlan)).not.toContain("SELECT");
  });

  it("blocks dry-run when the dump checksum differs from the manifest", async () => {
    const fixture = await createFixture();
    await writeFile(fixture.dumpPath, gzipSync("-- Dump completed on 2026-08-06 11:00:00\n"));
    const registries = await loadMigrationRegistries(fixture.registryDirectory);
    const report = runMigrationPreflight(registries, await inspectLegacyDump(fixture.dumpPath));

    expect(report.issues.map((candidate) => candidate.code)).toContain("DUMP_SHA256_MISMATCH");
    expect(report.canDryRun).toBe(false);
    expect(report.canImport).toBe(false);
  });

  it("rejects an extraction query whose registered checksum was changed", async () => {
    const fixture = await createFixture();
    const registryPath = join(fixture.registryDirectory, "migration-query-registry.json");
    const registry = JSON.parse(await readFile(registryPath, "utf8")) as {
      queries: Array<{ extraction_sql: string }>;
    };
    const query = registry.queries[0];
    if (!query) {
      throw new Error("test query is missing");
    }
    query.extraction_sql = `${query.extraction_sql} `;
    await writeJson(registryPath, registry);

    await expect(loadMigrationRegistries(fixture.registryDirectory)).rejects.toMatchObject({
      code: "REGISTRY_QUERY_CHECKSUM_MISMATCH",
    });
  });
});

describe("migration CLI", () => {
  it("resolves configurable paths and rejects unsafe modes", () => {
    expect(
      parseMigrationCliArgs(
        ["plan", "--registries", "fixtures/registries", "--dump", "fixtures/source.sql.gz"],
        {},
        "/workspace/backend",
      ),
    ).toEqual({
      command: "plan",
      dumpPath: "/workspace/backend/fixtures/source.sql.gz",
      mode: "dry-run",
      registryDirectory: "/workspace/backend/fixtures/registries",
    });
    expect(() => parseMigrationCliArgs(["run", "--mode", "write"], {}, "/workspace/backend")).toThrow(
      /dry-run or import/u,
    );
  });

  it("prints only a safe plan and keeps import fail-closed without canonical transforms", async () => {
    const fixture = await createFixture();
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(
      runMigrationCli(["plan", "--registries", fixture.registryDirectory, "--dump", fixture.dumpPath]),
    ).resolves.toBe(0);
    const output = writeSpy.mock.calls.map((call) => String(call[0])).join("");
    expect(output).toContain('"sourceSystem": "bitrix"');
    expect(output).not.toContain("SELECT");

    await expect(
      runMigrationCli([
        "run",
        "--mode",
        "import",
        "--registries",
        fixture.registryDirectory,
        "--dump",
        fixture.dumpPath,
      ]),
    ).rejects.toMatchObject({ code: "IMPORT_CANONICAL_TRANSFORMS_REQUIRED" });

    await expect(
      runMigrationCli(
        ["run", "--registries", fixture.registryDirectory, "--dump", fixture.dumpPath],
        {},
        fixture.root,
      ),
    ).rejects.toMatchObject({ code: "MIGRATION_CONNECTION_CONFIG_REQUIRED" });
  });
});
