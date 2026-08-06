import { createHash } from "node:crypto";
import { type Kysely, type RawBuilder, sql, type Transaction } from "kysely";
import { newPublicId, newUuid } from "../../../common/id.js";
import type { Database } from "../../../db/types.js";
import { appendAuditEvent } from "../../platform/audit.js";
import type {
  CrmActivity,
  CrmCandidateSummary,
  CrmCaseDetail,
  CrmCaseSummary,
  CrmEmployerDetail,
  CrmEmployerSummary,
  CrmPersonSummary,
  CrmReferralDetail,
  CrmReferralSummary,
  CrmTaskDetail,
  CrmTaskSummary,
} from "../contracts.js";
import type {
  CrmAccessScope,
  CrmActivityRepositoryQuery,
  CrmCaseRepositoryQuery,
  CrmEmployerRepositoryQuery,
  CrmMutationResult,
  CrmPersonRepositoryQuery,
  CrmReferralRepositoryQuery,
  CrmRepositoryPage,
  CrmRepositoryPort,
  CrmTaskRepositoryQuery,
  CrmTimelineRepositoryQuery,
  CrmTransitionExecution,
} from "../ports.js";
import { CRM_FIELD_MASK } from "./postgres-crm-authorization.js";

type CrmExecutor = Kysely<Database> | Transaction<Database>;

export interface PostgresCrmRepositoryOptions {
  readonly auditPolicyVersion?: string;
}

interface CaseRow {
  id: string;
  public_id: string;
  title: string;
  funnel_code: string;
  funnel_version: number;
  stage_code: string;
  status: string;
  next_step: string | null;
  primary_person_id: string | null;
  owner_employee_profile_id: string | null;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
  attributes?: unknown;
}

interface EmployerRow {
  id: string;
  public_id: string;
  name: string;
  legal_name: string | null;
  tax_id_mask: string | null;
  status: string;
  organization_type: string;
  manual_review_reason?: string | null;
  owner_employee_profile_id: string | null;
  contact_count: number | string;
  open_referral_count: number | string;
  provenance?: unknown;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ReferralRow {
  id: string;
  public_id: string;
  case_id: string | null;
  person_id: string | null;
  employer_id: string | null;
  owner_employee_profile_id: string | null;
  stage_code: string;
  channel_code: string | null;
  vacancy_title: string | null;
  sent_at: Date | string | null;
  result_at: Date | string | null;
  comment?: string | null;
  provenance?: unknown;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
}

interface TaskRow {
  id: string;
  public_id: string;
  case_id: string | null;
  employer_referral_id: string | null;
  title: string;
  description: string | null;
  state: string;
  responsible_employee_profile_id: string | null;
  due_at: Date | string | null;
  completed_at: Date | string | null;
  priority: "low" | "normal" | "high" | "urgent";
  timezone: string;
  creator_user_account_id: string | null;
  is_overdue: boolean;
  provenance?: unknown;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ActivityRow {
  id: string;
  public_id: string;
  case_id: string | null;
  person_id: string | null;
  employer_id: string | null;
  employer_referral_id: string | null;
  activity_type: string;
  direction: string | null;
  subject: string | null;
  body_preview: string | null;
  delivery_state: string | null;
  occurred_at: Date | string;
  actor_employee_profile_id: string | null;
  legacy_actor_id: string | null;
  provenance: unknown;
}

interface CaseMutationRow {
  id: string;
  participation_id: string | null;
  stage_code: string;
  status: string;
  next_step: string | null;
  version: number;
}

interface AuditWriteInput {
  readonly aggregateType: "crm_case" | "crm_task";
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly eventType: string;
  readonly topic: string;
  readonly beforeState: Readonly<Record<string, unknown>>;
  readonly afterState: Readonly<Record<string, unknown>>;
  readonly command: CrmTransitionExecution;
  readonly occurredAt: Date;
}

const CLOSED_REFERRAL_STAGES = [
  "accepted",
  "rejected_by_employer",
  "rejected_by_candidate",
  "ignored",
  "cancelled",
] as const;

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}

function nullableDateOnly(value: Date | string | null): string | null {
  if (value === null) return null;
  return (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10);
}

function toNumber(value: number | string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid numeric database value: ${value}`);
  }
  return parsed;
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const PROVENANCE_ALLOWLIST = new Set([
  "sourceSystem",
  "sourceEntity",
  "sourceId",
  "snapshotSha256",
  "migrationRunId",
  "importedAt",
  "availability",
  "taskId",
  "fromState",
  "toState",
  "aggregateVersion",
  "transitionCode",
]);

export function sanitizeCrmProvenance(value: unknown): Record<string, unknown> {
  const source = asObject(value);
  return Object.fromEntries(
    Object.entries(source).filter(
      ([key, item]) =>
        PROVENANCE_ALLOWLIST.has(key) &&
        (item === null || ["string", "number", "boolean"].includes(typeof item)),
    ),
  );
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function crmAuditEventHash(value: unknown): string {
  return sha256(stableJson(value));
}

export function hasCrmTransitionEvidence(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export function missingCrmTransitionFields(
  requiredFields: readonly string[],
  evidence: Readonly<Record<string, unknown>>,
  stored: Readonly<Record<string, unknown>> = {},
): string[] {
  return requiredFields.filter(
    (field) => !hasCrmTransitionEvidence(evidence[field]) && !hasCrmTransitionEvidence(stored[field]),
  );
}

function hasField(access: CrmAccessScope, field: string): boolean {
  return access.fieldMask.includes(field);
}

function valuesSql(values: readonly string[]): RawBuilder<unknown> {
  return sql.join(values.map((value) => sql`${value}::uuid`));
}

export function employeeReferenceScope(
  access: CrmAccessScope,
  employeeReference: RawBuilder<unknown>,
): RawBuilder<boolean> {
  if (access.visibility === "all") {
    return sql<boolean>`true`;
  }
  const predicates: RawBuilder<boolean>[] = [];
  if (access.employeeProfileIds.length > 0) {
    predicates.push(sql<boolean>`${employeeReference} in (${valuesSql(access.employeeProfileIds)})`);
  }
  if (access.organizationUnitIds.length > 0) {
    predicates.push(sql<boolean>`exists (
      select 1
      from identity.employee_profile scope_employee
      where scope_employee.id = ${employeeReference}
        and scope_employee.archived_at is null
        and scope_employee.organization_unit_id in (${valuesSql(access.organizationUnitIds)})
    )`);
  }
  return predicates.length > 0 ? sql<boolean>`(${sql.join(predicates, sql` or `)})` : sql<boolean>`false`;
}

export function caseScopeSql(access: CrmAccessScope, caseAlias = "case_row"): RawBuilder<boolean> {
  if (access.visibility === "all") {
    return sql<boolean>`true`;
  }
  const caseId = sql.ref(`${caseAlias}.id`);
  const assignmentScope = employeeReferenceScope(access, sql.ref("scope_assignment.employee_profile_id"));
  return sql<boolean>`exists (
    select 1
    from crm.case_assignment scope_assignment
    where scope_assignment.case_id = ${caseId}
      and scope_assignment.valid_to is null
      and scope_assignment.archived_at is null
      and ${assignmentScope}
  )`;
}

function personScopeSql(access: CrmAccessScope, personAlias = "person"): RawBuilder<boolean> {
  if (access.visibility === "all") {
    return sql<boolean>`true`;
  }
  const linkedCaseScope = caseScopeSql(access, "scope_case");
  return sql<boolean>`exists (
    select 1
    from crm.case_person scope_case_person
    join crm."case" scope_case on scope_case.id = scope_case_person.case_id
    where scope_case_person.person_id = ${sql.ref(`${personAlias}.id`)}
      and scope_case.archived_at is null
      and ${linkedCaseScope}
  )`;
}

export function referralScopeSql(access: CrmAccessScope, referralAlias = "referral"): RawBuilder<boolean> {
  if (access.visibility === "all") {
    return sql<boolean>`true`;
  }
  const directOwnerScope = employeeReferenceScope(
    access,
    sql.ref(`${referralAlias}.owner_employee_profile_id`),
  );
  const linkedCaseScope = caseScopeSql(access, "scope_case");
  const linkedPersonScope = caseScopeSql(access, "person_scope_case");
  return sql<boolean>`(
    ${directOwnerScope}
    or exists (
      select 1 from crm."case" scope_case
      where scope_case.id = ${sql.ref(`${referralAlias}.case_id`)}
        and scope_case.archived_at is null
        and ${linkedCaseScope}
    )
    or exists (
      select 1
      from crm.case_person person_scope_link
      join crm."case" person_scope_case on person_scope_case.id = person_scope_link.case_id
      where person_scope_link.person_id = ${sql.ref(`${referralAlias}.person_id`)}
        and person_scope_case.archived_at is null
        and ${linkedPersonScope}
    )
  )`;
}

export function employerScopeSql(access: CrmAccessScope, employerAlias = "employer"): RawBuilder<boolean> {
  if (access.visibility === "all") {
    return sql<boolean>`true`;
  }
  const referralScope = referralScopeSql(access, "scope_referral");
  const assignmentScope = employeeReferenceScope(
    access,
    sql.ref("scope_employer_assignment.employee_profile_id"),
  );
  return sql<boolean>`(
    exists (
      select 1 from crm.employer_assignment scope_employer_assignment
      where scope_employer_assignment.employer_id = ${sql.ref(`${employerAlias}.id`)}
        and scope_employer_assignment.valid_to is null
        and scope_employer_assignment.archived_at is null
        and ${assignmentScope}
    )
    or exists (
      select 1 from crm.employer_referral scope_referral
      where scope_referral.employer_id = ${sql.ref(`${employerAlias}.id`)}
        and scope_referral.archived_at is null
        and ${referralScope}
    )
  )`;
}

export function taskScopeSql(access: CrmAccessScope, taskAlias = "task_row"): RawBuilder<boolean> {
  if (access.visibility === "all") {
    return sql<boolean>`true`;
  }
  const responsibleScope = employeeReferenceScope(
    access,
    sql.ref(`${taskAlias}.responsible_employee_profile_id`),
  );
  const linkedCaseScope = caseScopeSql(access, "scope_case");
  const linkedReferralScope = referralScopeSql(access, "scope_referral");
  return sql<boolean>`(
    ${responsibleScope}
    or exists (
      select 1 from crm."case" scope_case
      where scope_case.id = ${sql.ref(`${taskAlias}.case_id`)}
        and scope_case.archived_at is null
        and ${linkedCaseScope}
    )
    or exists (
      select 1 from crm.employer_referral scope_referral
      where scope_referral.id = ${sql.ref(`${taskAlias}.employer_referral_id`)}
        and scope_referral.archived_at is null
        and ${linkedReferralScope}
    )
  )`;
}

function activityScopeSql(access: CrmAccessScope, activityAlias = "activity"): RawBuilder<boolean> {
  if (access.visibility === "all") {
    return sql<boolean>`true`;
  }
  const linkedCaseScope = caseScopeSql(access, "scope_case");
  const linkedPersonScope = personScopeSql(access, "scope_person");
  const linkedEmployerScope = employerScopeSql(access, "scope_employer");
  const linkedReferralScope = referralScopeSql(access, "scope_referral");
  return sql<boolean>`(
    exists (
      select 1 from crm."case" scope_case
      where scope_case.id = ${sql.ref(`${activityAlias}.case_id`)}
        and scope_case.archived_at is null
        and ${linkedCaseScope}
    )
    or exists (
      select 1 from identity.person scope_person
      where scope_person.id = ${sql.ref(`${activityAlias}.person_id`)}
        and scope_person.archived_at is null
        and ${linkedPersonScope}
    )
    or exists (
      select 1 from crm.employer scope_employer
      where scope_employer.id = ${sql.ref(`${activityAlias}.employer_id`)}
        and scope_employer.archived_at is null
        and ${linkedEmployerScope}
    )
    or exists (
      select 1 from crm.employer_referral scope_referral
      where scope_referral.id = ${sql.ref(`${activityAlias}.employer_referral_id`)}
        and scope_referral.archived_at is null
        and ${linkedReferralScope}
    )
  )`;
}

function cursorSql(
  timestampColumn: string,
  idColumn: string,
  cursor: { readonly createdAt: string; readonly id: string },
): RawBuilder<boolean> {
  return sql<boolean>`(
    ${sql.ref(timestampColumn)}, ${sql.ref(idColumn)}
  ) < (${new Date(cursor.createdAt)}, ${cursor.id}::uuid)`;
}

/**
 * Matches a CRM aggregate by either its internal UUID or its stable public id.
 * The UUID column is compared as text so a public id never reaches a PostgreSQL
 * uuid cast. Both values remain Kysely parameters.
 */
export function crmEntityIdentifierSql(alias: string, identifier: string): RawBuilder<boolean> {
  return sql<boolean>`(
    ${sql.ref(`${alias}.id`)}::text = ${identifier}
    or ${sql.ref(`${alias}.public_id`)} = ${identifier}
  )`;
}

function uuidIdentifierSql(column: string, identifier: string): RawBuilder<boolean> {
  return sql<boolean>`${sql.ref(column)}::text = ${identifier}`;
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function mapCase(row: CaseRow): CrmCaseSummary {
  return {
    id: row.id,
    publicId: row.public_id,
    title: row.title,
    funnelCode: row.funnel_code,
    funnelVersion: toNumber(row.funnel_version),
    stageCode: row.stage_code,
    status: row.status,
    nextStep: row.next_step,
    primaryPersonId: row.primary_person_id,
    ownerEmployeeProfileId: row.owner_employee_profile_id,
    version: toNumber(row.version),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapEmployer(row: EmployerRow): CrmEmployerSummary {
  return {
    id: row.id,
    publicId: row.public_id,
    name: row.name,
    legalName: row.legal_name,
    taxIdMask: row.tax_id_mask,
    status: row.status,
    organizationType: row.organization_type,
    contactCount: toNumber(row.contact_count),
    openReferralCount: toNumber(row.open_referral_count),
    version: toNumber(row.version),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapReferral(row: ReferralRow): CrmReferralSummary {
  return {
    id: row.id,
    publicId: row.public_id,
    caseId: row.case_id,
    personId: row.person_id,
    employerId: row.employer_id,
    ownerEmployeeProfileId: row.owner_employee_profile_id,
    stageCode: row.stage_code,
    channelCode: row.channel_code,
    vacancyTitle: row.vacancy_title,
    sentAt: nullableIso(row.sent_at),
    resultAt: nullableIso(row.result_at),
    version: toNumber(row.version),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapTask(row: TaskRow): CrmTaskSummary {
  return {
    id: row.id,
    publicId: row.public_id,
    caseId: row.case_id,
    employerReferralId: row.employer_referral_id,
    title: row.title,
    description: row.description,
    state: row.state,
    responsibleEmployeeProfileId: row.responsible_employee_profile_id,
    dueAt: nullableIso(row.due_at),
    completedAt: nullableIso(row.completed_at),
    priority: row.priority,
    timezone: row.timezone,
    creatorUserAccountId: row.creator_user_account_id,
    isOverdue: row.is_overdue,
    version: toNumber(row.version),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapActivity(row: ActivityRow): CrmActivity {
  return {
    id: row.id,
    publicId: row.public_id,
    caseId: row.case_id,
    personId: row.person_id,
    employerId: row.employer_id,
    employerReferralId: row.employer_referral_id,
    activityType: row.activity_type,
    direction: row.direction,
    subject: row.subject,
    bodyPreview: row.body_preview,
    deliveryState: row.delivery_state,
    occurredAt: toIso(row.occurred_at),
    actorEmployeeProfileId: row.actor_employee_profile_id,
    legacyActorId: row.legacy_actor_id,
    provenance: sanitizeCrmProvenance(row.provenance),
  };
}

function pageFromRows<T extends { readonly id: string; readonly createdAt: string }>(
  rows: readonly T[],
  limit: number,
): CrmRepositoryPage<T> {
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? { createdAt: last.createdAt, id: last.id } : null,
    hasMore,
  };
}

export class PostgresCrmRepository implements CrmRepositoryPort {
  private readonly auditPolicyVersion: string;

  constructor(
    private readonly db: Kysely<Database>,
    options: PostgresCrmRepositoryOptions = {},
  ) {
    this.auditPolicyVersion = options.auditPolicyVersion ?? "crm-policy@1";
  }

  async listCases(
    access: CrmAccessScope,
    query: CrmCaseRepositoryQuery,
  ): Promise<CrmRepositoryPage<CrmCaseSummary>> {
    let statement = this.caseSelect(this.db, access).where("case_row.archived_at", "is", null);
    if (query.funnelCode) statement = statement.where("case_row.funnel_code", "=", query.funnelCode);
    if (query.funnelVersion) {
      statement = statement.where("case_row.funnel_version", "=", query.funnelVersion);
    }
    if (query.stageCode) statement = statement.where("case_row.stage_code", "=", query.stageCode);
    if (query.status) statement = statement.where("case_row.status", "=", query.status);
    if (query.personId) {
      statement = statement.where(sql<boolean>`exists (
        select 1 from crm.case_person filter_person
        where filter_person.case_id = case_row.id
          and filter_person.person_id::text = ${query.personId}
      )`);
    }
    if (query.ownerEmployeeProfileId) {
      statement = statement.where(sql<boolean>`exists (
        select 1 from crm.case_assignment filter_owner
        where filter_owner.case_id = case_row.id
          and filter_owner.employee_profile_id::text = ${query.ownerEmployeeProfileId}
          and filter_owner.role = 'owner'
          and filter_owner.valid_to is null
          and filter_owner.archived_at is null
      )`);
    }
    if (query.search) {
      const pattern = `%${escapeLike(query.search.trim())}%`;
      statement = statement.where((expression) =>
        expression.or([
          expression("case_row.title", "ilike", pattern),
          expression("case_row.public_id", "ilike", pattern),
        ]),
      );
    }
    if (query.cursor) {
      statement = statement.where(cursorSql("case_row.created_at", "case_row.id", query.cursor));
    }
    const rows = (await statement
      .orderBy("case_row.created_at", "desc")
      .orderBy("case_row.id", "desc")
      .limit(query.limit + 1)
      .execute()) as CaseRow[];
    return pageFromRows(rows.map(mapCase), query.limit);
  }

  async getCase(access: CrmAccessScope, caseId: string): Promise<CrmCaseDetail | null> {
    return this.getCaseWithExecutor(this.db, access, caseId);
  }

  async listPeople(
    access: CrmAccessScope,
    query: CrmPersonRepositoryQuery,
  ): Promise<CrmRepositoryPage<CrmPersonSummary>> {
    const visibleCase = caseScopeSql(access, "visible_case");
    let statement = this.db
      .selectFrom("crm.profile as profile")
      .innerJoin("identity.person as person", "person.id", "profile.person_id")
      .select([
        "profile.id as profile_id",
        "person.id",
        sql<string>`concat_ws(' ', person.surname, person.given_name, person.middle_name)`.as("display_name"),
        sql<string | null>`case
          when person.normalized_email is null then null
          else left(person.normalized_email::text, 1) || '***@' || split_part(person.normalized_email::text, '@', 2)
        end`.as("email_mask"),
        sql<string | null>`case
          when person.normalized_phone is null then null
          else '+***' || right(person.normalized_phone, 4)
        end`.as("phone_mask"),
        "profile.profile_state",
        "profile.data_quality_state",
        sql<number>`(
          select count(distinct visible_link.case_id)::int
          from crm.case_person visible_link
          join crm."case" visible_case on visible_case.id = visible_link.case_id
          where visible_link.person_id = person.id
            and visible_case.archived_at is null
            and visible_case.status = 'open'
            and ${visibleCase}
        )`.as("active_case_count"),
        "profile.created_at",
        "profile.updated_at",
      ])
      .where("profile.archived_at", "is", null)
      .where("person.archived_at", "is", null)
      .where(personScopeSql(access, "person"));
    if (query.profileState) statement = statement.where("profile.profile_state", "=", query.profileState);
    if (query.dataQualityState) {
      statement = statement.where("profile.data_quality_state", "=", query.dataQualityState);
    }
    if (query.programType) {
      statement = statement.where(sql<boolean>`exists (
        select 1 from crm.program_participation filter_participation
        where filter_participation.crm_profile_id = profile.id
          and filter_participation.program_type = ${query.programType}
          and filter_participation.archived_at is null
      )`);
    }
    if (query.search) {
      const pattern = `%${escapeLike(query.search.trim())}%`;
      statement = statement.where(sql<boolean>`(
        concat_ws(' ', person.surname, person.given_name, person.middle_name) ilike ${pattern} escape '\\'
        or person.normalized_email::text ilike ${pattern} escape '\\'
        or person.normalized_phone ilike ${pattern} escape '\\'
      )`);
    }
    if (query.cursor) {
      statement = statement.where(cursorSql("profile.created_at", "profile.id", query.cursor));
    }
    const rows = await statement
      .orderBy("profile.created_at", "desc")
      .orderBy("profile.id", "desc")
      .limit(query.limit + 1)
      .execute();
    const hasMore = rows.length > query.limit;
    const pageRows = rows.slice(0, query.limit);
    const mapped = pageRows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      contactMask: { email: row.email_mask, phone: row.phone_mask },
      profileState: row.profile_state,
      dataQualityState: row.data_quality_state,
      activeCaseCount: toNumber(row.active_case_count),
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    }));
    const last = pageRows.at(-1);
    return {
      items: mapped,
      nextCursor: hasMore && last ? { createdAt: toIso(last.created_at), id: last.profile_id } : null,
      hasMore,
    };
  }

  async getCandidateSummary(access: CrmAccessScope, personId: string): Promise<CrmCandidateSummary | null> {
    const profile = await this.db
      .selectFrom("crm.profile as profile")
      .innerJoin("identity.person as person", "person.id", "profile.person_id")
      .select([
        "profile.id as profile_id",
        "person.id",
        sql<string>`concat_ws(' ', person.surname, person.given_name, person.middle_name)`.as("display_name"),
        sql<
          string | null
        >`case when person.normalized_email is null then null else left(person.normalized_email::text, 1) || '***@' || split_part(person.normalized_email::text, '@', 2) end`.as(
          "email_mask",
        ),
        sql<
          string | null
        >`case when person.normalized_phone is null then null else '+***' || right(person.normalized_phone, 4) end`.as(
          "phone_mask",
        ),
        "profile.profile_state",
        "profile.data_quality_state",
        "profile.created_at",
        "profile.updated_at",
      ])
      .where(
        sql<boolean>`(
          ${uuidIdentifierSql("person.id", personId)}
          or ${uuidIdentifierSql("profile.id", personId)}
        )`,
      )
      .where("profile.archived_at", "is", null)
      .where("person.archived_at", "is", null)
      .where(personScopeSql(access, "person"))
      .executeTakeFirst();
    if (!profile) return null;

    const [participations, caseRows, referralCountRow, pendingTaskCountRow] = await Promise.all([
      this.db
        .selectFrom("crm.program_participation")
        .select(["id", "program_type", "status", "started_at", "ended_at"])
        .where("crm_profile_id", "=", profile.profile_id)
        .where("archived_at", "is", null)
        .orderBy("started_at", "desc")
        .execute(),
      this.caseSelect(this.db, access)
        .where("case_row.archived_at", "is", null)
        .where(sql<boolean>`exists (
          select 1 from crm.case_person candidate_case
          where candidate_case.case_id = case_row.id and candidate_case.person_id = ${profile.id}::uuid
        )`)
        .orderBy("case_row.created_at", "desc")
        .execute() as Promise<CaseRow[]>,
      this.db
        .selectFrom("crm.employer_referral as referral")
        .select(sql<number>`count(*)::int`.as("count"))
        .where("referral.person_id", "=", profile.id)
        .where("referral.archived_at", "is", null)
        .where(referralScopeSql(access, "referral"))
        .executeTakeFirstOrThrow(),
      this.db
        .selectFrom("crm.task as task_row")
        .select(sql<number>`count(*)::int`.as("count"))
        .where("task_row.state", "in", ["to_do", "in_progress"])
        .where("task_row.archived_at", "is", null)
        .where(taskScopeSql(access, "task_row"))
        .where(sql<boolean>`exists (
          select 1 from crm.case_person candidate_task_case
          where candidate_task_case.case_id = task_row.case_id
            and candidate_task_case.person_id = ${profile.id}::uuid
        )`)
        .executeTakeFirstOrThrow(),
    ]);

    const person: CrmPersonSummary = {
      id: profile.id,
      displayName: profile.display_name,
      contactMask: { email: profile.email_mask, phone: profile.phone_mask },
      profileState: profile.profile_state,
      dataQualityState: profile.data_quality_state,
      activeCaseCount: caseRows.filter((row) => row.status === "open").length,
      createdAt: toIso(profile.created_at),
      updatedAt: toIso(profile.updated_at),
    };
    return {
      person,
      participations: participations.map((participation) => ({
        id: participation.id,
        programType: participation.program_type,
        status: participation.status,
        startedAt: toIso(participation.started_at),
        endedAt: nullableIso(participation.ended_at),
      })),
      cases: caseRows.map(mapCase),
      referralCount: toNumber(referralCountRow.count),
      pendingTaskCount: toNumber(pendingTaskCountRow.count),
    };
  }

  async listEmployers(
    access: CrmAccessScope,
    query: CrmEmployerRepositoryQuery,
  ): Promise<CrmRepositoryPage<CrmEmployerSummary>> {
    let statement = this.employerSelect(this.db, access).where("employer.archived_at", "is", null);
    if (query.status) statement = statement.where("employer.status", "=", query.status);
    if (query.search) {
      const pattern = `%${escapeLike(query.search.trim())}%`;
      statement = statement.where((expression) =>
        expression.or([
          expression("employer.name", "ilike", pattern),
          expression("employer.legal_name", "ilike", pattern),
          expression("employer.public_id", "ilike", pattern),
          expression("employer.normalized_tax_id", "ilike", pattern),
        ]),
      );
    }
    if (query.cursor) {
      statement = statement.where(cursorSql("employer.created_at", "employer.id", query.cursor));
    }
    const rows = (await statement
      .orderBy("employer.created_at", "desc")
      .orderBy("employer.id", "desc")
      .limit(query.limit + 1)
      .execute()) as EmployerRow[];
    return pageFromRows(rows.map(mapEmployer), query.limit);
  }

  async getEmployer(access: CrmAccessScope, employerId: string): Promise<CrmEmployerDetail | null> {
    return this.getEmployerWithExecutor(this.db, access, employerId);
  }

  async listReferrals(
    access: CrmAccessScope,
    query: CrmReferralRepositoryQuery,
  ): Promise<CrmRepositoryPage<CrmReferralSummary>> {
    let statement = this.referralSelect(this.db, access).where("referral.archived_at", "is", null);
    if (query.caseId) {
      statement = statement.where(sql<boolean>`(
        referral.case_id::text = ${query.caseId}
        or exists (
          select 1 from crm."case" identifier_case
          where identifier_case.id = referral.case_id
            and identifier_case.public_id = ${query.caseId}
        )
      )`);
    }
    if (query.personId) {
      statement = statement.where(uuidIdentifierSql("referral.person_id", query.personId));
    }
    if (query.employerId) {
      statement = statement.where(sql<boolean>`(
        referral.employer_id::text = ${query.employerId}
        or exists (
          select 1 from crm.employer identifier_employer
          where identifier_employer.id = referral.employer_id
            and identifier_employer.public_id = ${query.employerId}
        )
      )`);
    }
    if (query.ownerEmployeeProfileId) {
      statement = statement.where(
        uuidIdentifierSql("referral.owner_employee_profile_id", query.ownerEmployeeProfileId),
      );
    }
    if (query.stageCode) statement = statement.where("referral.stage_code", "=", query.stageCode);
    if (query.cursor) {
      statement = statement.where(cursorSql("referral.created_at", "referral.id", query.cursor));
    }
    const rows = (await statement
      .orderBy("referral.created_at", "desc")
      .orderBy("referral.id", "desc")
      .limit(query.limit + 1)
      .execute()) as ReferralRow[];
    return pageFromRows(rows.map(mapReferral), query.limit);
  }

  async getReferral(access: CrmAccessScope, referralId: string): Promise<CrmReferralDetail | null> {
    const row = (await this.referralSelect(this.db, access)
      .select(["referral.provenance", "referral.comment"])
      .where("referral.archived_at", "is", null)
      .where(crmEntityIdentifierSql("referral", referralId))
      .executeTakeFirst()) as ReferralRow | undefined;
    if (!row) return null;
    const stageHistory = await this.db
      .selectFrom("crm.employer_referral_stage_history")
      .select([
        "id",
        "from_stage_code",
        "to_stage_code",
        "reason_code",
        "reason_text",
        "actor_user_account_id",
        "aggregate_version",
        "occurred_at",
      ])
      .where("employer_referral_id", "=", row.id)
      .orderBy("aggregate_version", "asc")
      .execute();
    return {
      ...mapReferral(row),
      comment: row.comment ?? null,
      stageHistory: stageHistory.map((history) => ({
        id: history.id,
        fromStageCode: history.from_stage_code,
        toStageCode: history.to_stage_code,
        reasonCode: history.reason_code,
        reasonText: history.reason_text,
        actorUserAccountId: history.actor_user_account_id,
        aggregateVersion: toNumber(history.aggregate_version),
        occurredAt: toIso(history.occurred_at),
      })),
      provenance: sanitizeCrmProvenance(row.provenance),
    };
  }

  async listTasks(
    access: CrmAccessScope,
    query: CrmTaskRepositoryQuery,
  ): Promise<CrmRepositoryPage<CrmTaskSummary>> {
    let statement = this.taskSelect(this.db, access).where("task_row.archived_at", "is", null);
    if (query.caseId) {
      statement = statement.where(sql<boolean>`(
        task_row.case_id::text = ${query.caseId}
        or exists (
          select 1 from crm."case" identifier_case
          where identifier_case.id = task_row.case_id
            and identifier_case.public_id = ${query.caseId}
        )
      )`);
    }
    if (query.referralId) {
      statement = statement.where(sql<boolean>`(
        task_row.employer_referral_id::text = ${query.referralId}
        or exists (
          select 1 from crm.employer_referral identifier_referral
          where identifier_referral.id = task_row.employer_referral_id
            and identifier_referral.public_id = ${query.referralId}
        )
      )`);
    }
    if (query.state) statement = statement.where("task_row.state", "=", query.state);
    if (query.responsibleEmployeeProfileId) {
      statement = statement.where(
        uuidIdentifierSql("task_row.responsible_employee_profile_id", query.responsibleEmployeeProfileId),
      );
    }
    if (query.overdue !== undefined) {
      statement = statement.where(
        sql<boolean>`(
          task_row.due_at is not null
          and task_row.due_at < clock_timestamp()
          and task_row.state in ('to_do', 'in_progress')
        ) = ${query.overdue}`,
      );
    }
    if (query.cursor) {
      statement = statement.where(cursorSql("task_row.created_at", "task_row.id", query.cursor));
    }
    const rows = (await statement
      .orderBy("task_row.created_at", "desc")
      .orderBy("task_row.id", "desc")
      .limit(query.limit + 1)
      .execute()) as TaskRow[];
    return pageFromRows(rows.map(mapTask), query.limit);
  }

  async getTask(access: CrmAccessScope, taskId: string): Promise<CrmTaskDetail | null> {
    return this.getTaskWithExecutor(this.db, access, taskId);
  }

  async listActivities(
    access: CrmAccessScope,
    query: CrmActivityRepositoryQuery,
  ): Promise<CrmRepositoryPage<CrmActivity>> {
    let statement = this.activitySelect(this.db, access).where(activityScopeSql(access, "activity"));
    if (query.caseId) {
      statement = statement.where(sql<boolean>`(
        activity.case_id::text = ${query.caseId}
        or exists (
          select 1 from crm."case" identifier_case
          where identifier_case.id = activity.case_id
            and identifier_case.public_id = ${query.caseId}
        )
      )`);
    }
    if (query.personId) {
      statement = statement.where(uuidIdentifierSql("activity.person_id", query.personId));
    }
    if (query.employerId) {
      statement = statement.where(sql<boolean>`(
        activity.employer_id::text = ${query.employerId}
        or exists (
          select 1 from crm.employer identifier_employer
          where identifier_employer.id = activity.employer_id
            and identifier_employer.public_id = ${query.employerId}
        )
      )`);
    }
    if (query.referralId) {
      statement = statement.where(sql<boolean>`(
        activity.employer_referral_id::text = ${query.referralId}
        or exists (
          select 1 from crm.employer_referral identifier_referral
          where identifier_referral.id = activity.employer_referral_id
            and identifier_referral.public_id = ${query.referralId}
        )
      )`);
    }
    if (query.activityType) {
      statement = statement.where("activity.activity_type", "=", query.activityType);
    }
    if (query.direction) statement = statement.where("activity.direction", "=", query.direction);
    if (query.cursor) {
      statement = statement.where(cursorSql("activity.occurred_at", "activity.id", query.cursor));
    }
    const rows = (await statement
      .orderBy("activity.occurred_at", "desc")
      .orderBy("activity.id", "desc")
      .limit(query.limit + 1)
      .execute()) as ActivityRow[];
    return this.activityPage(rows, query.limit);
  }

  async listCaseTimeline(
    access: CrmAccessScope,
    caseId: string,
    query: CrmTimelineRepositoryQuery,
  ): Promise<CrmRepositoryPage<CrmActivity> | null> {
    const visible = await this.db
      .selectFrom("crm.case as case_row")
      .select("case_row.id")
      .where(crmEntityIdentifierSql("case_row", caseId))
      .where("case_row.archived_at", "is", null)
      .where(caseScopeSql(access, "case_row"))
      .executeTakeFirst();
    if (!visible) return null;

    let statement = this.activitySelect(this.db, access)
      .where("activity.case_id", "=", visible.id)
      .where(activityScopeSql(access, "activity"));
    if (query.activityType) {
      statement = statement.where("activity.activity_type", "=", query.activityType);
    }
    if (query.cursor) {
      statement = statement.where(cursorSql("activity.occurred_at", "activity.id", query.cursor));
    }
    const rows = (await statement
      .orderBy("activity.occurred_at", "desc")
      .orderBy("activity.id", "desc")
      .limit(query.limit + 1)
      .execute()) as ActivityRow[];
    return this.activityPage(rows, query.limit);
  }

  async transitionCase(command: CrmTransitionExecution): Promise<CrmMutationResult<CrmCaseDetail>> {
    return this.db.transaction().execute(async (transaction) => {
      const current = await transaction
        .selectFrom("crm.case as case_row")
        .selectAll("case_row")
        .where("case_row.id", "=", command.aggregateId)
        .where("case_row.archived_at", "is", null)
        .where(caseScopeSql(command.access, "case_row"))
        .forUpdate()
        .executeTakeFirst();
      if (!current) return { kind: "not_found" };
      const currentVersion = toNumber(current.version);
      if (currentVersion !== command.expectedVersion) {
        return { kind: "version_conflict", currentVersion };
      }
      if (current.stage_code !== command.fromState) {
        return { kind: "state_conflict", currentState: current.stage_code, currentVersion };
      }

      const guardErrors = await this.caseGuardErrors(transaction, current, command);
      if (guardErrors.length > 0) return { kind: "guard_failed", errors: guardErrors };

      const updated = await transaction
        .updateTable("crm.case")
        .set({
          stage_code: command.toState,
          ...(command.targetAggregateStatus ? { status: command.targetAggregateStatus } : {}),
        })
        .where("id", "=", current.id)
        .where("version", "=", command.expectedVersion)
        .where("stage_code", "=", command.fromState)
        .returning(["id", "version", "stage_code", "status", "updated_at"])
        .executeTakeFirst();
      if (!updated) {
        const conflict = await transaction
          .selectFrom("crm.case")
          .select(["version", "stage_code"])
          .where("id", "=", current.id)
          .executeTakeFirst();
        return conflict
          ? {
              kind: "state_conflict",
              currentState: conflict.stage_code,
              currentVersion: toNumber(conflict.version),
            }
          : { kind: "not_found" };
      }

      const occurredAt = new Date();
      const aggregateVersion = toNumber(updated.version);
      await transaction
        .insertInto("crm.case_stage_history")
        .values({
          id: newUuid(),
          case_id: current.id,
          from_stage_code: current.stage_code,
          to_stage_code: updated.stage_code,
          reason_code: command.reasonCode,
          reason_text: command.reasonText,
          actor_user_account_id: command.actor.userAccountId,
          source_stage: null,
          aggregate_version: aggregateVersion,
          occurred_at: occurredAt,
          created_at: occurredAt,
        })
        .execute();
      await this.writeAuditAndOutbox(transaction, {
        aggregateType: "crm_case",
        aggregateId: current.id,
        aggregateVersion,
        eventType: "crm.case.transitioned",
        topic: "crm.case.transitioned.v1",
        beforeState: { stageCode: current.stage_code, status: current.status, version: currentVersion },
        afterState: {
          stageCode: updated.stage_code,
          status: updated.status,
          version: aggregateVersion,
        },
        command,
        occurredAt,
      });

      const detail = await this.getCaseWithExecutor(transaction, command.access, current.id);
      if (!detail) throw new Error("Updated CRM case disappeared inside its transaction");
      return { kind: "updated", value: detail };
    });
  }

  async transitionTask(command: CrmTransitionExecution): Promise<CrmMutationResult<CrmTaskDetail>> {
    return this.db.transaction().execute(async (transaction) => {
      const current = await transaction
        .selectFrom("crm.task as task_row")
        .selectAll("task_row")
        .where("task_row.id", "=", command.aggregateId)
        .where("task_row.archived_at", "is", null)
        .where(taskScopeSql(command.access, "task_row"))
        .forUpdate()
        .executeTakeFirst();
      if (!current) return { kind: "not_found" };
      const currentVersion = toNumber(current.version);
      if (currentVersion !== command.expectedVersion) {
        return { kind: "version_conflict", currentVersion };
      }
      if (current.state !== command.fromState) {
        return { kind: "state_conflict", currentState: current.state, currentVersion };
      }

      const guardErrors = missingCrmTransitionFields(command.transition.requiredFields, command.evidence).map(
        (field) => ({
          field,
          code: "required",
          message: `Не выполнено условие перехода: ${field}`,
        }),
      );
      if (!current.case_id && !current.employer_referral_id) {
        guardErrors.push({
          field: "linked_crm_object",
          code: "required",
          message: "Задача должна быть связана с CRM-кейсом или направлением",
        });
      }
      if (guardErrors.length > 0) return { kind: "guard_failed", errors: guardErrors };

      const occurredAt = new Date();
      const updated = await transaction
        .updateTable("crm.task")
        .set({
          state: command.toState,
          completed_at: command.toState === "done" ? occurredAt : null,
        })
        .where("id", "=", current.id)
        .where("version", "=", command.expectedVersion)
        .where("state", "=", command.fromState)
        .returning(["id", "version", "state", "completed_at"])
        .executeTakeFirst();
      if (!updated) {
        const conflict = await transaction
          .selectFrom("crm.task")
          .select(["version", "state"])
          .where("id", "=", current.id)
          .executeTakeFirst();
        return conflict
          ? {
              kind: "state_conflict",
              currentState: conflict.state,
              currentVersion: toNumber(conflict.version),
            }
          : { kind: "not_found" };
      }

      const aggregateVersion = toNumber(updated.version);
      await transaction
        .insertInto("crm.task_history")
        .values({
          id: newUuid(),
          task_id: current.id,
          change_type: "transitioned",
          before_state: { state: current.state, version: currentVersion },
          after_state: {
            state: updated.state,
            version: aggregateVersion,
            reasonCode: command.reasonCode,
            reasonText: command.reasonText,
          },
          actor_user_account_id: command.actor.userAccountId,
          aggregate_version: aggregateVersion,
          occurred_at: occurredAt,
          created_at: occurredAt,
        })
        .execute();
      await transaction
        .insertInto("crm.activity")
        .values({
          id: newUuid(),
          public_id: newPublicId("activity"),
          case_id: current.case_id,
          person_id: null,
          employer_id: null,
          employer_referral_id: current.employer_referral_id,
          activity_type: "task_state_changed",
          direction: null,
          subject: current.title,
          body_copy: null,
          delivery_state: null,
          occurred_at: occurredAt,
          actor_employee_profile_id: command.actor.employeeProfileId,
          legacy_actor_id: null,
          provenance: {
            taskId: current.id,
            fromState: current.state,
            toState: updated.state,
            aggregateVersion,
            transitionCode: command.transition.code,
          },
          created_at: occurredAt,
        })
        .execute();
      await this.writeAuditAndOutbox(transaction, {
        aggregateType: "crm_task",
        aggregateId: current.id,
        aggregateVersion,
        eventType: "crm.task.transitioned",
        topic: "crm.task.transitioned.v1",
        beforeState: { state: current.state, version: currentVersion },
        afterState: { state: updated.state, version: aggregateVersion },
        command,
        occurredAt,
      });

      const detail = await this.getTaskWithExecutor(transaction, command.access, current.id);
      if (!detail) throw new Error("Updated CRM task disappeared inside its transaction");
      return { kind: "updated", value: detail };
    });
  }

  private caseSelect(executor: CrmExecutor, access: CrmAccessScope) {
    return executor
      .selectFrom("crm.case as case_row")
      .select([
        "case_row.id",
        "case_row.public_id",
        "case_row.title",
        "case_row.funnel_code",
        "case_row.funnel_version",
        "case_row.stage_code",
        "case_row.status",
        "case_row.next_step",
        sql<string | null>`(
          select case_person.person_id::text
          from crm.case_person case_person
          where case_person.case_id = case_row.id and case_person.is_primary
          order by case_person.created_at, case_person.person_id
          limit 1
        )`.as("primary_person_id"),
        sql<string | null>`(
          select case_owner.employee_profile_id::text
          from crm.case_assignment case_owner
          where case_owner.case_id = case_row.id
            and case_owner.role = 'owner'
            and case_owner.valid_to is null
            and case_owner.archived_at is null
          order by case_owner.valid_from desc, case_owner.id desc
          limit 1
        )`.as("owner_employee_profile_id"),
        "case_row.version",
        "case_row.created_at",
        "case_row.updated_at",
      ])
      .where(caseScopeSql(access, "case_row"));
  }

  private async getCaseWithExecutor(
    executor: CrmExecutor,
    access: CrmAccessScope,
    caseId: string,
  ): Promise<CrmCaseDetail | null> {
    const row = (await this.caseSelect(executor, access)
      .select("case_row.attributes")
      .where("case_row.archived_at", "is", null)
      .where(crmEntityIdentifierSql("case_row", caseId))
      .executeTakeFirst()) as CaseRow | undefined;
    if (!row) return null;

    const [people, assignments, participation, relocation] = await Promise.all([
      executor
        .selectFrom("crm.case_person as link")
        .innerJoin("identity.person as person", "person.id", "link.person_id")
        .select([
          "link.person_id",
          "link.relationship_type",
          "link.is_primary",
          sql<string>`concat_ws(' ', person.surname, person.given_name, person.middle_name)`.as(
            "display_name",
          ),
        ])
        .where("link.case_id", "=", row.id)
        .where("person.archived_at", "is", null)
        .orderBy("link.is_primary", "desc")
        .orderBy("link.created_at")
        .execute(),
      executor
        .selectFrom("crm.case_assignment")
        .select(["employee_profile_id", "legacy_actor_id", "role", "valid_from", "valid_to"])
        .where("case_id", "=", row.id)
        .where("archived_at", "is", null)
        .orderBy("valid_from", "desc")
        .execute(),
      executor
        .selectFrom("crm.case as case_row")
        .leftJoin(
          "crm.program_participation as participation",
          "participation.id",
          "case_row.participation_id",
        )
        .select([
          "participation.id",
          "participation.program_type",
          "participation.status",
          "participation.started_at",
          "participation.ended_at",
        ])
        .where("case_row.id", "=", row.id)
        .executeTakeFirst(),
      executor
        .selectFrom("crm.relocation_profile")
        .select([
          "employer_id",
          "position",
          "municipality",
          "locality",
          "planned_date",
          "actual_date",
          "offer_status",
          "employment_status",
          "household",
          "support_measures",
          "result_code",
          "result_reason",
        ])
        .where("case_id", "=", row.id)
        .where("archived_at", "is", null)
        .executeTakeFirst(),
    ]);

    const attributes: Record<string, unknown> = { ...asObject(row.attributes) };
    if (participation?.id) {
      attributes.programParticipation = {
        id: participation.id,
        programType: participation.program_type,
        status: participation.status,
        startedAt: participation.started_at ? toIso(participation.started_at) : null,
        endedAt: participation.ended_at ? toIso(participation.ended_at) : null,
      };
    }
    if (relocation) {
      attributes.relocation = {
        employerId: relocation.employer_id,
        position: relocation.position,
        municipality: relocation.municipality,
        locality: relocation.locality,
        plannedDate: nullableDateOnly(relocation.planned_date),
        actualDate: nullableDateOnly(relocation.actual_date),
        offerStatus: relocation.offer_status,
        employmentStatus: relocation.employment_status,
        household: asObject(relocation.household),
        supportMeasures: Array.isArray(relocation.support_measures)
          ? relocation.support_measures.filter((value): value is string => typeof value === "string")
          : [],
        resultCode: relocation.result_code,
        resultReason: relocation.result_reason,
      };
    }

    return {
      ...mapCase(row),
      people: people.map((person) => ({
        personId: person.person_id,
        relationshipType: person.relationship_type,
        isPrimary: person.is_primary,
        displayName: person.display_name,
      })),
      assignments: assignments.map((assignment) => ({
        employeeProfileId: assignment.employee_profile_id,
        legacyActorId: assignment.legacy_actor_id,
        role: assignment.role,
        validFrom: toIso(assignment.valid_from),
        validTo: nullableIso(assignment.valid_to),
      })),
      relocation: relocation
        ? {
            employerId: relocation.employer_id,
            position: relocation.position,
            municipality: relocation.municipality,
            locality: relocation.locality,
            plannedDate: nullableDateOnly(relocation.planned_date),
            actualDate: nullableDateOnly(relocation.actual_date),
            offerStatus: relocation.offer_status,
            employmentStatus: relocation.employment_status,
            household: asObject(relocation.household),
            supportMeasures: Array.isArray(relocation.support_measures)
              ? relocation.support_measures.filter((value): value is string => typeof value === "string")
              : [],
            resultCode: relocation.result_code,
            resultReason: relocation.result_reason,
          }
        : null,
      attributes,
    };
  }

  private employerSelect(executor: CrmExecutor, access: CrmAccessScope) {
    const visibleReferral = referralScopeSql(access, "count_referral");
    return executor
      .selectFrom("crm.employer as employer")
      .select([
        "employer.id",
        "employer.public_id",
        "employer.name",
        "employer.legal_name",
        sql<string | null>`case
          when employer.normalized_tax_id is null then null
          else repeat('*', greatest(length(employer.normalized_tax_id) - 4, 0)) || right(employer.normalized_tax_id, 4)
        end`.as("tax_id_mask"),
        "employer.status",
        "employer.organization_type",
        sql<string | null>`(
          select employer_owner.employee_profile_id::text
          from crm.employer_assignment employer_owner
          where employer_owner.employer_id = employer.id
            and employer_owner.role = 'owner'
            and employer_owner.valid_to is null
            and employer_owner.archived_at is null
          order by employer_owner.valid_from desc, employer_owner.id desc
          limit 1
        )`.as("owner_employee_profile_id"),
        sql<number>`(
          select count(*)::int from crm.employer_contact count_contact
          where count_contact.employer_id = employer.id and count_contact.archived_at is null
        )`.as("contact_count"),
        sql<number>`(
          select count(*)::int from crm.employer_referral count_referral
          where count_referral.employer_id = employer.id
            and count_referral.archived_at is null
            and count_referral.stage_code not in (${sql.join(
              CLOSED_REFERRAL_STAGES.map((stage) => sql`${stage}`),
            )})
            and ${visibleReferral}
        )`.as("open_referral_count"),
        "employer.version",
        "employer.created_at",
        "employer.updated_at",
      ])
      .where(employerScopeSql(access, "employer"));
  }

  private async getEmployerWithExecutor(
    executor: CrmExecutor,
    access: CrmAccessScope,
    employerId: string,
  ): Promise<CrmEmployerDetail | null> {
    const row = (await this.employerSelect(executor, access)
      .select(["employer.provenance", "employer.manual_review_reason"])
      .where("employer.archived_at", "is", null)
      .where(crmEntityIdentifierSql("employer", employerId))
      .executeTakeFirst()) as EmployerRow | undefined;
    if (!row) return null;

    const rawContacts = hasField(access, CRM_FIELD_MASK.EMPLOYER_CONTACT_RAW);
    const contacts = await executor
      .selectFrom("crm.employer_contact as contact")
      .select([
        "contact.id",
        "contact.name",
        "contact.position",
        rawContacts
          ? sql<string | null>`contact.email::text`.as("email_value")
          : sql<
              string | null
            >`case when contact.email is null then null else left(contact.email::text, 1) || '***@' || split_part(contact.email::text, '@', 2) end`.as(
              "email_value",
            ),
        rawContacts
          ? sql<string | null>`contact.phone`.as("phone_value")
          : sql<
              string | null
            >`case when contact.phone is null then null else '+***' || right(contact.phone, 4) end`.as(
              "phone_value",
            ),
        "contact.is_primary",
      ])
      .where("contact.employer_id", "=", row.id)
      .where("contact.archived_at", "is", null)
      .orderBy("contact.is_primary", "desc")
      .orderBy("contact.created_at")
      .execute();
    return {
      ...mapEmployer(row),
      contacts: contacts.map((contact) => ({
        id: contact.id,
        name: contact.name,
        position: contact.position,
        email: contact.email_value,
        phone: contact.phone_value,
        isPrimary: contact.is_primary,
      })),
      manualReviewReason: row.manual_review_reason ?? null,
      ownerEmployeeProfileId: row.owner_employee_profile_id,
      provenance: sanitizeCrmProvenance(row.provenance),
    };
  }

  private referralSelect(executor: CrmExecutor, access: CrmAccessScope) {
    return executor
      .selectFrom("crm.employer_referral as referral")
      .select([
        "referral.id",
        "referral.public_id",
        "referral.case_id",
        "referral.person_id",
        "referral.employer_id",
        "referral.owner_employee_profile_id",
        "referral.stage_code",
        "referral.channel_code",
        "referral.vacancy_title",
        "referral.sent_at",
        "referral.result_at",
        "referral.version",
        "referral.created_at",
        "referral.updated_at",
      ])
      .where(referralScopeSql(access, "referral"));
  }

  private taskSelect(executor: CrmExecutor, access: CrmAccessScope) {
    return executor
      .selectFrom("crm.task as task_row")
      .select([
        "task_row.id",
        "task_row.public_id",
        "task_row.case_id",
        "task_row.employer_referral_id",
        "task_row.title",
        "task_row.description",
        "task_row.state",
        "task_row.responsible_employee_profile_id",
        "task_row.due_at",
        "task_row.completed_at",
        "task_row.priority",
        "task_row.timezone",
        "task_row.creator_user_account_id",
        sql<boolean>`(
          task_row.due_at is not null
          and task_row.due_at < clock_timestamp()
          and task_row.state in ('to_do', 'in_progress')
        )`.as("is_overdue"),
        "task_row.version",
        "task_row.created_at",
        "task_row.updated_at",
      ])
      .where(taskScopeSql(access, "task_row"));
  }

  private async getTaskWithExecutor(
    executor: CrmExecutor,
    access: CrmAccessScope,
    taskId: string,
  ): Promise<CrmTaskDetail | null> {
    const row = (await this.taskSelect(executor, access)
      .select("task_row.provenance")
      .where("task_row.archived_at", "is", null)
      .where(crmEntityIdentifierSql("task_row", taskId))
      .executeTakeFirst()) as TaskRow | undefined;
    if (!row) return null;
    const [participants, checklist, comments] = await Promise.all([
      executor
        .selectFrom("crm.task_participant")
        .select(["employee_profile_id", "role", "valid_from"])
        .where("task_id", "=", row.id)
        .where("valid_to", "is", null)
        .orderBy("valid_from", "asc")
        .orderBy("id", "asc")
        .execute(),
      executor
        .selectFrom("crm.task_checklist_item")
        .select(["id", "title", "completed", "position", "version"])
        .where("task_id", "=", row.id)
        .where("archived_at", "is", null)
        .orderBy("position", "asc")
        .limit(200)
        .execute(),
      executor
        .selectFrom("crm.task_comment")
        .select(sql<number>`count(*)::int`.as("count"))
        .where("task_id", "=", row.id)
        .where("archived_at", "is", null)
        .executeTakeFirstOrThrow(),
    ]);
    return {
      ...mapTask(row),
      participants: participants.map((participant) => ({
        employeeProfileId: participant.employee_profile_id,
        role: participant.role,
        validFrom: toIso(participant.valid_from),
      })),
      checklist: checklist.map((item) => ({
        id: item.id,
        title: item.title,
        completed: item.completed,
        position: item.position,
        version: toNumber(item.version),
      })),
      commentCount: toNumber(comments.count),
      provenance: sanitizeCrmProvenance(row.provenance),
    };
  }

  private activitySelect(executor: CrmExecutor, access: CrmAccessScope) {
    const exposeBody = hasField(access, CRM_FIELD_MASK.ACTIVITY_BODY_PREVIEW);
    return executor
      .selectFrom("crm.activity as activity")
      .select([
        "activity.id",
        "activity.public_id",
        "activity.case_id",
        "activity.person_id",
        "activity.employer_id",
        "activity.employer_referral_id",
        "activity.activity_type",
        "activity.direction",
        "activity.subject",
        exposeBody
          ? sql<string | null>`left(activity.body_copy, 500)`.as("body_preview")
          : sql<string | null>`null`.as("body_preview"),
        "activity.delivery_state",
        "activity.occurred_at",
        "activity.actor_employee_profile_id",
        "activity.legacy_actor_id",
        "activity.provenance",
      ]);
  }

  private activityPage(rows: readonly ActivityRow[], limit: number): CrmRepositoryPage<CrmActivity> {
    const hasMore = rows.length > limit;
    const visibleRows = rows.slice(0, limit);
    const items = visibleRows.map(mapActivity);
    const last = visibleRows.at(-1);
    return {
      items,
      nextCursor: hasMore && last ? { createdAt: toIso(last.occurred_at), id: last.id } : null,
      hasMore,
    };
  }

  private async caseGuardErrors(
    transaction: Transaction<Database>,
    current: CaseMutationRow,
    command: CrmTransitionExecution,
  ): Promise<readonly { field: string; code: string; message: string }[]> {
    const [owner, participation, contact, referral, relocation, latestHistory] = await Promise.all([
      transaction
        .selectFrom("crm.case_assignment")
        .select("id")
        .where("case_id", "=", current.id)
        .where("role", "=", "owner")
        .where("valid_to", "is", null)
        .where("archived_at", "is", null)
        .executeTakeFirst(),
      current.participation_id
        ? transaction
            .selectFrom("crm.program_participation")
            .select("program_type")
            .where("id", "=", current.participation_id)
            .where("archived_at", "is", null)
            .executeTakeFirst()
        : Promise.resolve(undefined),
      transaction
        .selectFrom("crm.case_person as link")
        .innerJoin("identity.person as person", "person.id", "link.person_id")
        .select(["person.normalized_email", "person.normalized_phone"])
        .where("link.case_id", "=", current.id)
        .where("link.is_primary", "=", true)
        .where("person.archived_at", "is", null)
        .executeTakeFirst(),
      transaction
        .selectFrom("crm.employer_referral")
        .select(["id", "stage_code", "employer_id", "vacancy_title"])
        .where("case_id", "=", current.id)
        .where("archived_at", "is", null)
        .orderBy("created_at", "desc")
        .execute(),
      transaction
        .selectFrom("crm.relocation_profile")
        .select(["employer_id", "position", "municipality", "locality", "actual_date"])
        .where("case_id", "=", current.id)
        .where("archived_at", "is", null)
        .executeTakeFirst(),
      transaction
        .selectFrom("crm.case_stage_history")
        .select(["from_stage_code", "to_stage_code"])
        .where("case_id", "=", current.id)
        .orderBy("occurred_at", "desc")
        .orderBy("id", "desc")
        .executeTakeFirst(),
    ]);

    const approvedReferral = referral.find((item) => ["approved", "accepted"].includes(item.stage_code));
    const stored: Readonly<Record<string, unknown>> = {
      owner_id: owner?.id,
      next_step: current.next_step,
      program_type: participation?.program_type,
      normalized_contact: contact?.normalized_email ?? contact?.normalized_phone,
      employer_referral_id: referral.at(0)?.id,
      host_referral_id: referral.at(0)?.id,
      approved_referral_id: approvedReferral?.id,
      accepted_host_id: approvedReferral?.employer_id,
      employer_id: relocation?.employer_id ?? approvedReferral?.employer_id,
      job_title: relocation?.position ?? approvedReferral?.vacancy_title,
      municipality: relocation?.municipality,
      locality: relocation?.locality,
      actual_relocation_date: relocation?.actual_date,
    };

    const errors = missingCrmTransitionFields(
      command.transition.requiredFields,
      command.evidence,
      stored,
    ).map((field) => ({
      field,
      code: "required",
      message: `Не выполнено условие перехода: ${field}`,
    }));

    if (
      command.transition.targetGuard?.type === "equals_history_field" &&
      command.transition.targetGuard.field === "last_open_state" &&
      latestHistory?.from_stage_code !== command.toState
    ) {
      errors.push({
        field: "target_state",
        code: "history_guard_failed",
        message: "Возобновление разрешено только на предыдущую открытую стадию",
      });
    }
    return errors;
  }

  private async writeAuditAndOutbox(
    transaction: Transaction<Database>,
    input: AuditWriteInput,
  ): Promise<void> {
    const metadata = {
      transitionCode: input.command.transition.code,
      machineCode: input.command.machineCode,
      machineVersion: input.command.machineVersion,
      requiredFields: [...input.command.transition.requiredFields],
    };
    await appendAuditEvent(transaction, {
      eventType: input.eventType,
      actorType: "user",
      actorId: input.command.actor.userAccountId,
      subjectType: input.aggregateType,
      subjectId: input.aggregateId,
      requestId: input.command.actor.requestId,
      reason: input.command.reasonText ?? input.command.reasonCode,
      beforeState: input.beforeState,
      afterState: input.afterState,
      metadata,
      policyVersion: this.auditPolicyVersion,
      scopeSnapshot: {
        visibility: input.command.access.visibility,
        employeeProfileIds: [...input.command.access.employeeProfileIds],
        organizationUnitIds: [...input.command.access.organizationUnitIds],
      },
      occurredAt: input.occurredAt,
    });
    await transaction
      .insertInto("platform.outbox_event")
      .values({
        id: newUuid(),
        topic: input.topic,
        aggregate_type: input.aggregateType,
        aggregate_id: input.aggregateId,
        payload: {
          aggregateId: input.aggregateId,
          aggregateVersion: input.aggregateVersion,
          transitionCode: input.command.transition.code,
          fromState: input.command.fromState,
          toState: input.command.toState,
          occurredAt: input.occurredAt.toISOString(),
        },
        idempotency_key: `${input.topic}:${input.aggregateId}:v${input.aggregateVersion}`,
        occurred_at: input.occurredAt,
        available_at: input.occurredAt,
        attempt_count: 0,
        locked_at: null,
        locked_by: null,
        delivered_at: null,
        last_error_code: null,
      })
      .execute();
  }
}
