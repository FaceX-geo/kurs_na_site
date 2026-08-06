import { createHash } from "node:crypto";
import { createConnection, type RowDataPacket } from "mysql2/promise";
import { Client } from "pg";
import { MigrationError } from "./errors.js";

export const JULY_22_TEST_SNAPSHOT_SHA256 =
  "7d38354b78f7c30423462799f088f097cd129eb3934b4e29b3664b0f648e79bf" as const;
export const JULY_22_TEST_SNAPSHOT_CONFIRMATION = "RESTORE_2026-07-22_TEST_ONLY" as const;

const EXPECTED_SOURCE_TABLES = 1669;
const EXPECTED_COUNTS = {
  actors: 218,
  canonicalEmployees: 19,
  canonicalContacts: 2546,
  canonicalEmployers: 797,
  canonicalCases: 1237,
  canonicalCrmTasks: 38,
} as const;
const UUID_NAMESPACE = "kurs-na-sever:test-snapshot-materialization:v1";
const ADVISORY_LOCK_KEY = 4_936_470_150;

interface LegacyActorRow extends RowDataPacket {
  ACTIVE: string;
  BLOCKED: string;
  DATE_REGISTER: Date | string | null;
  HAS_DEPARTMENT_LINK: number;
  ID: number;
  LAST_NAME: string | null;
  NAME: string | null;
  SECOND_NAME: string | null;
}

interface LegacyContactRow extends RowDataPacket {
  ASSIGNED_BY_ID: number;
  BIRTHDATE: Date | string | null;
  DATE_CREATE: Date | string | null;
  ID: number;
  LAST_NAME: string;
  NAME: string;
  OWNER_IS_ACTIVE: number;
  SECOND_NAME: string | null;
}

interface LegacyEmployerRow extends RowDataPacket {
  ASSIGNED_BY_ID: number;
  COMPANY_TYPE: string | null;
  DATE_CREATE: Date | string | null;
  ID: number;
  OWNER_IS_ACTIVE: number;
  TITLE: string;
}

interface LegacyRequisiteRow extends RowDataPacket {
  ENTITY_ID: number;
  NAME: string | null;
  NORMALIZED_TAX_ID: string | null;
}

interface LegacyContactPointRow extends RowDataPacket {
  ELEMENT_ID: number;
  ENTITY_ID: "COMPANY" | "CONTACT";
  ID: number;
  TYPE_ID: "EMAIL" | "PHONE";
  VALUE: string;
}

interface LegacyCaseRow extends RowDataPacket {
  ASSIGNED_BY_ID: number;
  CLOSED: string;
  CLOSEDATE: Date | string | null;
  COMPANY_ID: number | null;
  CONTACT_ID: number;
  DATE_CREATE: Date | string | null;
  ID: number;
  SOURCE_ID: string | null;
  STAGE_ID: string;
  TITLE: string;
}

interface LegacyTaskRow extends RowDataPacket {
  CLOSED_DATE: Date | string | null;
  CREATED_DATE: Date | string | null;
  DEADLINE: Date | string | null;
  DESCRIPTION: string | null;
  ID: number;
  PRIORITY: number | string | null;
  RESPONSIBLE_ID: number;
  STATUS: number | string;
  TITLE: string;
  UF_CRM_TASK: string;
}

export interface TestSnapshotMaterializationConfig {
  readonly confirmation: typeof JULY_22_TEST_SNAPSHOT_CONFIRMATION;
  readonly databaseUrl: string;
  readonly legacyMysqlUrl: string;
  readonly snapshotSha256: typeof JULY_22_TEST_SNAPSHOT_SHA256;
}

export interface TestSnapshotMaterializationSummary {
  readonly alreadyCompleted: boolean;
  readonly counts: Readonly<Record<string, number>>;
  readonly snapshotSha256: typeof JULY_22_TEST_SNAPSHOT_SHA256;
  readonly sourceTableCount: number;
}

type MaterializationStep =
  | "ACTORS"
  | "CASES"
  | "CONTACTS"
  | "CONTACT_POINTS"
  | "CRM_TASKS"
  | "EMPLOYERS"
  | "REQUISITES";

async function runMaterializationStep<T>(step: MaterializationStep, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof MigrationError) throw error;
    throw new MigrationError(
      `TEST_SNAPSHOT_${step}_FAILED`,
      `Test snapshot materialization failed during the ${step.toLowerCase()} step`,
      { cause: error },
    );
  }
}

function requireUrl(value: string | undefined, protocol: readonly string[], name: string): string {
  if (!value) throw new MigrationError("TEST_SNAPSHOT_CONFIG_REQUIRED", `${name} is required`);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new MigrationError("TEST_SNAPSHOT_CONFIG_INVALID", `${name} is not a valid URL`, {
      cause: error,
    });
  }
  if (!protocol.includes(parsed.protocol) || parsed.hostname.length === 0) {
    throw new MigrationError("TEST_SNAPSHOT_CONFIG_INVALID", `${name} uses an unsupported protocol`);
  }
  return value;
}

export function readTestSnapshotMaterializationConfig(
  environment: NodeJS.ProcessEnv = process.env,
): TestSnapshotMaterializationConfig {
  if (environment.CRM_TEST_SNAPSHOT_IMPORT !== "true") {
    throw new MigrationError(
      "TEST_SNAPSHOT_IMPORT_DISABLED",
      "Test snapshot materialization requires CRM_TEST_SNAPSHOT_IMPORT=true",
    );
  }
  if (environment.CRM_TEST_SNAPSHOT_IMPORT_CONFIRM !== JULY_22_TEST_SNAPSHOT_CONFIRMATION) {
    throw new MigrationError(
      "TEST_SNAPSHOT_CONFIRMATION_REQUIRED",
      "Test snapshot materialization requires the exact July 22 confirmation phrase",
    );
  }
  if (environment.CRM_TEST_SNAPSHOT_SHA256 !== JULY_22_TEST_SNAPSHOT_SHA256) {
    throw new MigrationError(
      "TEST_SNAPSHOT_IDENTITY_MISMATCH",
      "Test snapshot SHA-256 differs from the pinned July 22 source",
    );
  }
  return {
    confirmation: JULY_22_TEST_SNAPSHOT_CONFIRMATION,
    databaseUrl: requireUrl(environment.DATABASE_URL, ["postgres:", "postgresql:"], "DATABASE_URL"),
    legacyMysqlUrl: requireUrl(environment.LEGACY_MYSQL_URL, ["mysql:"], "LEGACY_MYSQL_URL"),
    snapshotSha256: JULY_22_TEST_SNAPSHOT_SHA256,
  };
}

export function stableLegacyUuid(sourceEntity: string, sourceId: number | string): string {
  const bytes = createHash("sha256")
    .update(`${UUID_NAMESPACE}:${JULY_22_TEST_SNAPSHOT_SHA256}:${sourceEntity}:${sourceId}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function nonBlank(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function iso(value: Date | string | null, fallback = "2026-07-22T00:00:00.000Z"): string {
  if (value === null) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? fallback : date.toISOString();
}

export function normalizeLegacyPhone(value: string): string | null {
  const digits = value.replace(/[^0-9]/gu, "");
  if (digits.length === 10) return `+7${digits}`;
  if (digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8"))) {
    return `+7${digits.slice(1)}`;
  }
  return digits.length >= 8 && digits.length <= 15 && !digits.startsWith("0") ? `+${digits}` : null;
}

function normalizedEmail(value: string): string | null {
  const candidate = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(candidate) ? candidate : null;
}

function legacyTaskCaseId(value: string): number | null {
  const match = /(?:^|[^A-Z])D_(\d+)(?:[^0-9]|$)/u.exec(value);
  if (!match?.[1]) return null;
  const parsed = Number(match[1]);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function taskState(status: number | string): "cancelled" | "done" | "in_progress" | "to_do" {
  const value = Number(status);
  if (value === 5) return "done";
  if (value === 6 || value === 7) return "cancelled";
  if (value === 2 || value === 3 || value === 4) return "in_progress";
  return "to_do";
}

function taskPriority(priority: number | string | null): "high" | "normal" {
  return Number(priority) >= 2 ? "high" : "normal";
}

function caseStatus(closed: string, stage: string): "closed_unsuccessful" | "completed" | "open" {
  if (closed !== "Y") return "open";
  return /WON|SUCCESS|FINAL_INVOICE/iu.test(stage) ? "completed" : "closed_unsuccessful";
}

function stageCode(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  return `legacy_${normalized || "unmapped"}`;
}

async function queryRows<T extends RowDataPacket>(
  connection: Awaited<ReturnType<typeof createConnection>>,
  sql: string,
): Promise<T[]> {
  const [rows] = await connection.query<T[]>(sql);
  return rows;
}

async function sourceTableCount(connection: Awaited<ReturnType<typeof createConnection>>): Promise<number> {
  const rows = await queryRows<RowDataPacket & { count: number }>(
    connection,
    "SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema=DATABASE()",
  );
  const count = Number(rows[0]?.count);
  if (count !== EXPECTED_SOURCE_TABLES) {
    throw new MigrationError(
      "TEST_SNAPSHOT_SOURCE_COUNT_MISMATCH",
      `July 22 source table count drifted: ${count}`,
    );
  }
  return count;
}

async function upsertLegacyReference(
  client: Client,
  sourceEntity: string,
  sourceId: number | string,
  targetType: string,
  targetId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO platform.legacy_reference
       (source_system, source_entity, source_id, target_type, target_id, snapshot_sha256)
     VALUES ('bitrix', $1, $2, $3, $4::uuid, $5)
     ON CONFLICT (source_system, source_entity, source_id) DO UPDATE
       SET target_type = EXCLUDED.target_type,
           target_id = EXCLUDED.target_id,
           snapshot_sha256 = EXCLUDED.snapshot_sha256
     WHERE platform.legacy_reference.target_type = EXCLUDED.target_type
       AND platform.legacy_reference.target_id = EXCLUDED.target_id`,
    [sourceEntity, String(sourceId), targetType, targetId, JULY_22_TEST_SNAPSHOT_SHA256],
  );
}

async function materializeActors(
  mysql: Awaited<ReturnType<typeof createConnection>>,
  pg: Client,
): Promise<{ actors: number; employees: number }> {
  const rows = await queryRows<LegacyActorRow>(
    mysql,
    `
    SELECT u.ID, u.ACTIVE, u.BLOCKED, u.NAME, u.LAST_NAME, u.SECOND_NAME, u.DATE_REGISTER,
           CASE WHEN department.VALUE_ID IS NULL THEN 0 ELSE 1 END AS HAS_DEPARTMENT_LINK
    FROM b_user u
    LEFT JOIN (SELECT DISTINCT VALUE_ID FROM b_utm_user WHERE FIELD_ID = 40) department
      ON department.VALUE_ID = u.ID
    ORDER BY u.ID`,
  );
  if (rows.length !== EXPECTED_COUNTS.actors) {
    throw new MigrationError("TEST_SNAPSHOT_SOURCE_COUNT_MISMATCH", "Legacy actor count drifted");
  }
  let employees = 0;
  for (const row of rows) {
    const actorId = stableLegacyUuid("b_user.actor", row.ID);
    const givenName = nonBlank(row.NAME);
    const surname = nonBlank(row.LAST_NAME);
    const isEmployee = row.HAS_DEPARTMENT_LINK === 1 && givenName !== null && surname !== null;
    const classification = isEmployee
      ? row.ACTIVE === "Y" && row.BLOCKED !== "Y"
        ? "active_employee"
        : "inactive_employee"
      : "external";
    let employeeId: string | null = null;
    if (isEmployee && givenName && surname) {
      const personId = stableLegacyUuid("b_user.person", row.ID);
      employeeId = stableLegacyUuid("b_user.employee", row.ID);
      await pg.query(
        `INSERT INTO identity.person
           (id, surname, given_name, middle_name, created_at, updated_at)
         VALUES ($1::uuid, $2, $3, $4, $5::timestamptz, $5::timestamptz)
         ON CONFLICT (id) DO NOTHING`,
        [personId, surname, givenName, nonBlank(row.SECOND_NAME), iso(row.DATE_REGISTER)],
      );
      await pg.query(
        `INSERT INTO identity.employee_profile
           (id, person_id, employee_number, employment_state, created_at, updated_at)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5::timestamptz, $5::timestamptz)
         ON CONFLICT (id) DO NOTHING`,
        [
          employeeId,
          personId,
          `bitrix-${row.ID}`,
          row.ACTIVE === "Y" && row.BLOCKED !== "Y" ? "active" : "inactive",
          iso(row.DATE_REGISTER),
        ],
      );
      await upsertLegacyReference(pg, "b_user.person", row.ID, "identity.person", personId);
      await upsertLegacyReference(
        pg,
        "b_user.employee_profile",
        row.ID,
        "identity.employee_profile",
        employeeId,
      );
      employees += 1;
    }
    await pg.query(
      `INSERT INTO migration.legacy_actor
         (id, source_user_id, display_label, classification, employee_profile_id, provenance)
       VALUES ($1::uuid, $2, $3, $4, $5::uuid,
         jsonb_build_object('sourceSystem','bitrix','sourceEntity','b_user','sourceId',$2::text,'snapshotSha256',$6::text))
       ON CONFLICT (source_user_id) DO UPDATE
         SET employee_profile_id = EXCLUDED.employee_profile_id
       WHERE migration.legacy_actor.id = EXCLUDED.id`,
      [
        actorId,
        String(row.ID),
        [surname, givenName].filter(Boolean).join(" ") || `Legacy actor ${row.ID}`,
        classification,
        employeeId,
        JULY_22_TEST_SNAPSHOT_SHA256,
      ],
    );
    await upsertLegacyReference(pg, "b_user.actor", row.ID, "migration.legacy_actor", actorId);
  }
  if (employees !== EXPECTED_COUNTS.canonicalEmployees) {
    throw new MigrationError("TEST_SNAPSHOT_CLASSIFICATION_DRIFT", "Canonical employee count drifted");
  }
  return { actors: rows.length, employees };
}

async function materializeContacts(
  mysql: Awaited<ReturnType<typeof createConnection>>,
  pg: Client,
): Promise<number> {
  const rows = await queryRows<LegacyContactRow>(
    mysql,
    `
    SELECT c.ID, c.ASSIGNED_BY_ID, c.NAME, c.SECOND_NAME, c.LAST_NAME, c.BIRTHDATE, c.DATE_CREATE,
           CASE WHEN owner.ACTIVE = 'Y' THEN 1 ELSE 0 END AS OWNER_IS_ACTIVE
    FROM b_crm_contact c
    JOIN b_user owner ON owner.ID = c.ASSIGNED_BY_ID
    WHERE NULLIF(TRIM(c.NAME), '') IS NOT NULL
      AND NULLIF(TRIM(c.LAST_NAME), '') IS NOT NULL
    ORDER BY c.ID`,
  );
  if (rows.length !== EXPECTED_COUNTS.canonicalContacts) {
    throw new MigrationError("TEST_SNAPSHOT_SOURCE_COUNT_MISMATCH", "Canonical contact count drifted");
  }
  for (const row of rows) {
    const personId = stableLegacyUuid("b_crm_contact.person", row.ID);
    const profileId = stableLegacyUuid("b_crm_contact.profile", row.ID);
    await pg.query(
      `INSERT INTO identity.person
         (id, surname, given_name, middle_name, birth_date, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, $4, $5::date, $6::timestamptz, $6::timestamptz)
       ON CONFLICT (id) DO NOTHING`,
      [
        personId,
        row.LAST_NAME.trim(),
        row.NAME.trim(),
        nonBlank(row.SECOND_NAME),
        row.BIRTHDATE,
        iso(row.DATE_CREATE),
      ],
    );
    await pg.query(
      `INSERT INTO crm.profile
         (id, person_id, profile_state, data_quality_state, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, 'active', $3, $4::timestamptz, $4::timestamptz)
       ON CONFLICT (id) DO NOTHING`,
      [profileId, personId, row.OWNER_IS_ACTIVE === 1 ? "verified" : "needs_review", iso(row.DATE_CREATE)],
    );
    await upsertLegacyReference(pg, "b_crm_contact.person", row.ID, "identity.person", personId);
    await upsertLegacyReference(pg, "b_crm_contact.profile", row.ID, "crm.profile", profileId);
  }
  return rows.length;
}

async function materializeEmployers(
  mysql: Awaited<ReturnType<typeof createConnection>>,
  pg: Client,
): Promise<number> {
  const rows = await queryRows<LegacyEmployerRow>(
    mysql,
    `
    SELECT c.ID, c.ASSIGNED_BY_ID, c.TITLE, c.COMPANY_TYPE, c.DATE_CREATE,
           CASE WHEN owner.ACTIVE = 'Y' THEN 1 ELSE 0 END AS OWNER_IS_ACTIVE
    FROM b_crm_company c
    JOIN b_user owner ON owner.ID = c.ASSIGNED_BY_ID
    WHERE NULLIF(TRIM(c.TITLE), '') IS NOT NULL
    ORDER BY c.ID`,
  );
  if (rows.length !== EXPECTED_COUNTS.canonicalEmployers) {
    throw new MigrationError("TEST_SNAPSHOT_SOURCE_COUNT_MISMATCH", "Canonical employer count drifted");
  }
  for (const row of rows) {
    const employerId = stableLegacyUuid("b_crm_company.employer", row.ID);
    await pg.query(
      `INSERT INTO crm.employer
         (id, public_id, name, status, provenance, manual_review_reason, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, $4,
         jsonb_build_object('sourceSystem','bitrix','sourceEntity','b_crm_company','sourceId',$5::text,'snapshotSha256',$6::text),
         $7, $8::timestamptz, $8::timestamptz)
       ON CONFLICT (id) DO NOTHING`,
      [
        employerId,
        `employer_legacy_${row.ID}`,
        row.TITLE.trim(),
        row.OWNER_IS_ACTIVE === 1 ? "active" : "needs_review",
        String(row.ID),
        JULY_22_TEST_SNAPSHOT_SHA256,
        row.OWNER_IS_ACTIVE === 1 ? null : "INACTIVE_OPERATIONAL_OWNER_REQUIRES_SIGNED_REASSIGNMENT",
        iso(row.DATE_CREATE),
      ],
    );
    await upsertLegacyReference(pg, "b_crm_company.employer", row.ID, "crm.employer", employerId);
  }
  return rows.length;
}

async function applyContactPoints(
  mysql: Awaited<ReturnType<typeof createConnection>>,
  pg: Client,
): Promise<number> {
  const rows = await queryRows<LegacyContactPointRow>(
    mysql,
    `
    SELECT m.ID, m.ENTITY_ID, m.ELEMENT_ID, m.TYPE_ID, m.VALUE
    FROM b_crm_field_multi m
    JOIN (
      SELECT TYPE_ID,
             CASE WHEN TYPE_ID='EMAIL' THEN LOWER(TRIM(VALUE)) ELSE REGEXP_REPLACE(VALUE, '[^0-9]', '') END normalized_value,
             COUNT(*) duplicate_count
      FROM b_crm_field_multi
      WHERE ENTITY_ID IN ('CONTACT','COMPANY') AND TYPE_ID IN ('EMAIL','PHONE')
      GROUP BY TYPE_ID, normalized_value
    ) duplicates
      ON duplicates.TYPE_ID=m.TYPE_ID
     AND duplicates.normalized_value=CASE WHEN m.TYPE_ID='EMAIL' THEN LOWER(TRIM(m.VALUE)) ELSE REGEXP_REPLACE(m.VALUE, '[^0-9]', '') END
     AND duplicates.duplicate_count=1
    LEFT JOIN b_crm_contact contact ON m.ENTITY_ID='CONTACT' AND contact.ID=m.ELEMENT_ID
    LEFT JOIN b_user contact_owner ON contact_owner.ID=contact.ASSIGNED_BY_ID
    LEFT JOIN b_crm_company company ON m.ENTITY_ID='COMPANY' AND company.ID=m.ELEMENT_ID
    LEFT JOIN b_user company_owner ON company_owner.ID=company.ASSIGNED_BY_ID
    WHERE m.ENTITY_ID IN ('CONTACT','COMPANY') AND m.TYPE_ID IN ('EMAIL','PHONE')
      AND ((m.ENTITY_ID='CONTACT' AND contact_owner.ACTIVE='Y' AND NULLIF(TRIM(contact.NAME),'') IS NOT NULL AND NULLIF(TRIM(contact.LAST_NAME),'') IS NOT NULL)
        OR (m.ENTITY_ID='COMPANY' AND company_owner.ACTIVE='Y' AND NULLIF(TRIM(company.TITLE),'') IS NOT NULL))
    ORDER BY m.ID`,
  );
  for (const row of rows) {
    const value = row.TYPE_ID === "EMAIL" ? normalizedEmail(row.VALUE) : normalizeLegacyPhone(row.VALUE);
    if (value === null) continue;
    if (row.ENTITY_ID === "CONTACT") {
      const personId = stableLegacyUuid("b_crm_contact.person", row.ELEMENT_ID);
      const column = row.TYPE_ID === "EMAIL" ? "normalized_email" : "normalized_phone";
      await pg.query(
        `UPDATE identity.person SET ${column}=$2, updated_at=clock_timestamp()
         WHERE id=$1::uuid AND ${column} IS NULL`,
        [personId, value],
      );
    } else {
      const employerId = stableLegacyUuid("b_crm_company.employer", row.ELEMENT_ID);
      const contactId = stableLegacyUuid("b_crm_field_multi.employer_contact", row.ID);
      await pg.query(
        `INSERT INTO crm.employer_contact
           (id, employer_id, name, email, phone)
         SELECT $1::uuid, employer.id, employer.name, $3, $4
         FROM crm.employer employer WHERE employer.id=$2::uuid
         ON CONFLICT (id) DO NOTHING`,
        [
          contactId,
          employerId,
          row.TYPE_ID === "EMAIL" ? value : null,
          row.TYPE_ID === "PHONE" ? value : null,
        ],
      );
      await upsertLegacyReference(
        pg,
        "b_crm_field_multi.employer_contact",
        row.ID,
        "crm.employer_contact",
        contactId,
      );
    }
  }
  return rows.length;
}

async function applyRequisites(
  mysql: Awaited<ReturnType<typeof createConnection>>,
  pg: Client,
): Promise<number> {
  const rows = await queryRows<LegacyRequisiteRow>(
    mysql,
    `
    SELECT r.ENTITY_ID, r.NAME,
           REPLACE(REPLACE(TRIM(r.RQ_INN), ' ', ''), '-', '') AS NORMALIZED_TAX_ID
    FROM b_crm_requisite r
    JOIN b_crm_company company ON company.ID=r.ENTITY_ID
    JOIN b_user owner ON owner.ID=company.ASSIGNED_BY_ID AND owner.ACTIVE='Y'
    JOIN (
      SELECT REPLACE(REPLACE(TRIM(RQ_INN), ' ', ''), '-', '') normalized_tax_id,
             COUNT(DISTINCT ENTITY_ID) duplicate_count
      FROM b_crm_requisite
      WHERE ENTITY_TYPE_ID=4 AND NULLIF(TRIM(RQ_INN),'') IS NOT NULL
      GROUP BY normalized_tax_id
    ) duplicates
      ON duplicates.normalized_tax_id=REPLACE(REPLACE(TRIM(r.RQ_INN), ' ', ''), '-', '')
     AND duplicates.duplicate_count=1
    WHERE r.ENTITY_TYPE_ID=4 AND NULLIF(TRIM(company.TITLE),'') IS NOT NULL
    ORDER BY r.ID`,
  );
  let applied = 0;
  for (const row of rows) {
    if (!/^[0-9]{10}([0-9]{2})?$/u.test(row.NORMALIZED_TAX_ID ?? "")) continue;
    const employerId = stableLegacyUuid("b_crm_company.employer", row.ENTITY_ID);
    const result = await pg.query(
      `UPDATE crm.employer
       SET normalized_tax_id=$2, legal_name=COALESCE(NULLIF($3,''), legal_name), updated_at=clock_timestamp()
       WHERE id=$1::uuid AND normalized_tax_id IS NULL`,
      [employerId, row.NORMALIZED_TAX_ID, nonBlank(row.NAME)],
    );
    applied += result.rowCount ?? 0;
  }
  return applied;
}

async function materializeCases(
  mysql: Awaited<ReturnType<typeof createConnection>>,
  pg: Client,
): Promise<number> {
  const rows = await queryRows<LegacyCaseRow>(
    mysql,
    `
    SELECT d.ID, d.TITLE, d.STAGE_ID, d.CONTACT_ID, d.COMPANY_ID, d.ASSIGNED_BY_ID,
           d.SOURCE_ID, d.DATE_CREATE, d.CLOSEDATE, d.CLOSED
    FROM b_crm_deal d
    JOIN b_user owner ON owner.ID=d.ASSIGNED_BY_ID AND owner.ACTIVE='Y'
    JOIN b_crm_contact contact ON contact.ID=d.CONTACT_ID
    JOIN b_user contact_owner ON contact_owner.ID=contact.ASSIGNED_BY_ID AND contact_owner.ACTIVE='Y'
    LEFT JOIN b_crm_company company ON company.ID=d.COMPANY_ID
    LEFT JOIN b_user company_owner ON company_owner.ID=company.ASSIGNED_BY_ID
    WHERE NULLIF(TRIM(d.TITLE),'') IS NOT NULL
      AND d.CATEGORY_ID=2
      AND NULLIF(TRIM(contact.NAME),'') IS NOT NULL
      AND NULLIF(TRIM(contact.LAST_NAME),'') IS NOT NULL
      AND (d.COMPANY_ID IS NULL OR d.COMPANY_ID=0 OR
        (company.ID IS NOT NULL AND company_owner.ACTIVE='Y' AND NULLIF(TRIM(company.TITLE),'') IS NOT NULL))
    ORDER BY d.ID`,
  );
  if (rows.length !== EXPECTED_COUNTS.canonicalCases) {
    throw new MigrationError("TEST_SNAPSHOT_SOURCE_COUNT_MISMATCH", "Canonical case count drifted");
  }
  const seenOpenRoutes = new Set<string>();
  for (const row of rows) {
    const caseId = stableLegacyUuid("b_crm_deal.case", row.ID);
    const personId = stableLegacyUuid("b_crm_contact.person", row.CONTACT_ID);
    const profileId = stableLegacyUuid("b_crm_contact.profile", row.CONTACT_ID);
    const participationId = stableLegacyUuid("b_crm_deal.participation", row.ID);
    const actorId = stableLegacyUuid("b_user.actor", row.ASSIGNED_BY_ID);
    const sourceStatus = caseStatus(row.CLOSED, row.STAGE_ID);
    const openRouteKey = `${row.CONTACT_ID}:relocation_legacy_category_2`;
    const duplicateOpenRoute = sourceStatus === "open" && seenOpenRoutes.has(openRouteKey);
    const canonicalStatus = duplicateOpenRoute ? "archived" : sourceStatus;
    if (sourceStatus === "open") seenOpenRoutes.add(openRouteKey);
    await pg.query(
      `INSERT INTO crm.program_participation
         (id, crm_profile_id, program_type, status, started_at, created_at, updated_at)
       VALUES ($1::uuid,$2::uuid,'relocation','legacy_test_import',$3::timestamptz,$3::timestamptz,$3::timestamptz)
       ON CONFLICT (id) DO NOTHING`,
      [participationId, profileId, iso(row.DATE_CREATE)],
    );
    await pg.query(
      `INSERT INTO crm."case"
         (id, public_id, participation_id, funnel_code, funnel_version, stage_code, title, status,
          next_step, attributes, source_created_at, created_at, updated_at)
       VALUES ($1::uuid,$2,$3::uuid,'relocation_legacy_category_2',1,$4,$5,$6,$7,
         jsonb_build_object('legacyStage',$8::text,'legacyCompanyId',$9::text,'sourceCode',$10::text,
           'testSnapshot',true,'duplicateOpenRoute',$11::boolean),
         $12::timestamptz,$12::timestamptz,$12::timestamptz)
       ON CONFLICT (id) DO NOTHING`,
      [
        caseId,
        `case_legacy_${row.ID}`,
        participationId,
        stageCode(row.STAGE_ID),
        row.TITLE.trim(),
        canonicalStatus,
        duplicateOpenRoute ? "Review duplicate open legacy route" : null,
        row.STAGE_ID,
        row.COMPANY_ID ? String(row.COMPANY_ID) : null,
        row.SOURCE_ID,
        duplicateOpenRoute,
        iso(row.DATE_CREATE),
      ],
    );
    await pg.query(
      `INSERT INTO crm.case_person (case_id,person_id,relationship_type,is_primary)
       VALUES ($1::uuid,$2::uuid,'candidate',true) ON CONFLICT DO NOTHING`,
      [caseId, personId],
    );
    await pg.query(
      `INSERT INTO crm.case_assignment
         (id,case_id,legacy_actor_id,role,valid_from,provenance,created_at,updated_at)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'owner',$4::timestamptz,
         jsonb_build_object('sourceSystem','bitrix','sourceEntity','b_crm_deal','sourceId',$5::text,'snapshotSha256',$6::text),
         $4::timestamptz,$4::timestamptz)
       ON CONFLICT (id) DO NOTHING`,
      [
        stableLegacyUuid("b_crm_deal.case_assignment", row.ID),
        caseId,
        actorId,
        iso(row.DATE_CREATE),
        String(row.ID),
        JULY_22_TEST_SNAPSHOT_SHA256,
      ],
    );
    await pg.query(
      `INSERT INTO crm.case_stage_history
         (id,case_id,to_stage_code,reason_code,source_stage,aggregate_version,occurred_at)
       VALUES ($1::uuid,$2::uuid,$3,'legacy_snapshot_import',$4,1,$5::timestamptz)
       ON CONFLICT (case_id,aggregate_version) DO NOTHING`,
      [
        stableLegacyUuid("b_crm_deal.stage_history", row.ID),
        caseId,
        stageCode(row.STAGE_ID),
        row.STAGE_ID,
        iso(row.DATE_CREATE),
      ],
    );
    await upsertLegacyReference(pg, "b_crm_deal.case", row.ID, "crm.case", caseId);
  }
  return rows.length;
}

async function materializeCrmTasks(
  mysql: Awaited<ReturnType<typeof createConnection>>,
  pg: Client,
): Promise<number> {
  const rows = await queryRows<LegacyTaskRow>(
    mysql,
    `
    SELECT t.ID,t.TITLE,t.DESCRIPTION,t.RESPONSIBLE_ID,t.STATUS,t.PRIORITY,t.DEADLINE,
           t.CREATED_DATE,t.CLOSED_DATE,uts.UF_CRM_TASK
    FROM b_tasks t
    JOIN b_uts_tasks_task uts ON uts.VALUE_ID=t.ID
    JOIN b_user responsible ON responsible.ID=t.RESPONSIBLE_ID AND responsible.ACTIVE='Y'
    WHERE uts.UF_CRM_TASK IS NOT NULL AND TRIM(uts.UF_CRM_TASK)<>'' AND uts.UF_CRM_TASK<>'a:0:{}'
      AND NOT (t.GROUP_ID>0)
    ORDER BY t.ID`,
  );
  if (rows.length !== EXPECTED_COUNTS.canonicalCrmTasks) {
    throw new MigrationError("TEST_SNAPSHOT_SOURCE_COUNT_MISMATCH", "Canonical CRM task count drifted");
  }
  for (const row of rows) {
    const state = taskState(row.STATUS);
    const linkedDealId = legacyTaskCaseId(row.UF_CRM_TASK);
    const caseId = linkedDealId === null ? null : stableLegacyUuid("b_crm_deal.case", linkedDealId);
    const employeeId = stableLegacyUuid("b_user.employee", row.RESPONSIBLE_ID);
    await pg.query(
      `INSERT INTO crm.task
         (id,public_id,case_id,title,description,state,responsible_employee_profile_id,due_at,completed_at,
          priority,provenance,created_at,updated_at)
       SELECT $1::uuid,$2,linked_case.id,$3,$4,$5,employee.id,$6::timestamptz,$7::timestamptz,$8,
         jsonb_build_object('sourceSystem','bitrix','sourceEntity','b_tasks','sourceId',$9::text,'snapshotSha256',$10::text),
         $11::timestamptz,$11::timestamptz
       FROM (SELECT $12::uuid AS id) desired_case
       LEFT JOIN crm."case" linked_case ON linked_case.id=desired_case.id
       LEFT JOIN identity.employee_profile employee ON employee.id=$13::uuid
       ON CONFLICT (id) DO NOTHING`,
      [
        stableLegacyUuid("b_tasks.crm_task", row.ID),
        `task_legacy_${row.ID}`,
        nonBlank(row.TITLE) ?? `Legacy task ${row.ID}`,
        nonBlank(row.DESCRIPTION),
        state,
        row.DEADLINE === null ? null : iso(row.DEADLINE),
        state === "done" ? iso(row.CLOSED_DATE ?? row.DEADLINE ?? row.CREATED_DATE) : null,
        taskPriority(row.PRIORITY),
        String(row.ID),
        JULY_22_TEST_SNAPSHOT_SHA256,
        iso(row.CREATED_DATE),
        caseId,
        employeeId,
      ],
    );
    await upsertLegacyReference(
      pg,
      "b_tasks.crm_task",
      row.ID,
      "crm.task",
      stableLegacyUuid("b_tasks.crm_task", row.ID),
    );
  }
  return rows.length;
}

export async function materializeJuly22TestSnapshot(
  config: TestSnapshotMaterializationConfig,
): Promise<TestSnapshotMaterializationSummary> {
  const mysql = await createConnection({ uri: config.legacyMysqlUrl, connectTimeout: 5_000 });
  const pg = new Client({ connectionString: config.databaseUrl, application_name: "kurs-crm-test-snapshot" });
  await pg.connect();
  let transactionOpen = false;
  let resolvedSourceTableCount = EXPECTED_SOURCE_TABLES;
  try {
    const tableCount = await sourceTableCount(mysql);
    resolvedSourceTableCount = tableCount;
    await pg.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
    const existing = await pg.query<{ state: string; counts: Record<string, number> }>(
      "SELECT state,counts FROM migration.test_snapshot_materialization WHERE snapshot_sha256=$1",
      [config.snapshotSha256],
    );
    if (existing.rows[0]?.state === "completed") {
      return {
        alreadyCompleted: true,
        counts: existing.rows[0].counts,
        snapshotSha256: config.snapshotSha256,
        sourceTableCount: tableCount,
      };
    }

    await pg.query("BEGIN");
    transactionOpen = true;
    await pg.query(
      `INSERT INTO migration.test_snapshot_materialization
         (snapshot_sha256,source_completed_at,environment,state,source_table_count,counts,started_at,finished_at,failure_code)
       VALUES ($1,'2026-07-22','test','running',$2,'{}'::jsonb,clock_timestamp(),NULL,NULL)
       ON CONFLICT (snapshot_sha256) DO UPDATE
         SET state='running',counts='{}'::jsonb,started_at=clock_timestamp(),finished_at=NULL,failure_code=NULL`,
      [config.snapshotSha256, tableCount],
    );
    const actorCounts = await runMaterializationStep("ACTORS", () => materializeActors(mysql, pg));
    const contacts = await runMaterializationStep("CONTACTS", () => materializeContacts(mysql, pg));
    const employers = await runMaterializationStep("EMPLOYERS", () => materializeEmployers(mysql, pg));
    const contactPoints = await runMaterializationStep("CONTACT_POINTS", () => applyContactPoints(mysql, pg));
    const requisites = await runMaterializationStep("REQUISITES", () => applyRequisites(mysql, pg));
    const cases = await runMaterializationStep("CASES", () => materializeCases(mysql, pg));
    const crmTasks = await runMaterializationStep("CRM_TASKS", () => materializeCrmTasks(mysql, pg));
    const counts = {
      actors: actorCounts.actors,
      canonicalCases: cases,
      canonicalContacts: contacts,
      canonicalCrmTasks: crmTasks,
      canonicalEmployees: actorCounts.employees,
      canonicalEmployers: employers,
      contactPointsProjected: contactPoints,
      employerRequisitesApplied: requisites,
    };
    await pg.query(
      `UPDATE migration.test_snapshot_materialization
       SET state='completed',counts=$2::jsonb,finished_at=clock_timestamp(),failure_code=NULL
       WHERE snapshot_sha256=$1`,
      [config.snapshotSha256, JSON.stringify(counts)],
    );
    await pg.query("COMMIT");
    transactionOpen = false;
    return {
      alreadyCompleted: false,
      counts,
      snapshotSha256: config.snapshotSha256,
      sourceTableCount: tableCount,
    };
  } catch (error) {
    if (transactionOpen) await pg.query("ROLLBACK").catch(() => undefined);
    const failureCode = error instanceof MigrationError ? error.code : "TEST_SNAPSHOT_MATERIALIZATION_FAILED";
    await pg
      .query(
        `INSERT INTO migration.test_snapshot_materialization
           (snapshot_sha256,source_completed_at,environment,state,source_table_count,counts,failure_code,finished_at)
         VALUES ($1,'2026-07-22','test','failed',$2,'{}'::jsonb,$3,clock_timestamp())
         ON CONFLICT (snapshot_sha256) DO UPDATE
           SET state='failed',counts='{}'::jsonb,failure_code=EXCLUDED.failure_code,finished_at=clock_timestamp()`,
        [config.snapshotSha256, resolvedSourceTableCount, failureCode],
      )
      .catch(() => undefined);
    throw error;
  } finally {
    await pg.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]).catch(() => undefined);
    await Promise.allSettled([mysql.end(), pg.end()]);
  }
}
