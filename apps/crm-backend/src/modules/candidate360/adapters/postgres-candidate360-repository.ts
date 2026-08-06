import { type Kysely, type RawBuilder, sql, type Transaction } from "kysely";
import { newUuid } from "../../../common/id.js";
import { UPLOAD_STORAGE_CEILING_BYTES } from "../../../common/upload-policy.js";
import type { Database } from "../../../db/types.js";
import type { CrmAccessScope, CrmActorContext } from "../../crm/ports.js";
import { appendAuditEvent } from "../../platform/audit.js";
import type {
  Candidate360Provenance,
  CandidateDocument,
  CandidateDocumentContentState,
  CandidateDocumentReviewResult,
  CandidateRecommender,
  DuplicateCandidate,
  MergeCandidateResult,
  RecommenderLink,
} from "../contracts.js";
import type {
  Candidate360MutationResult,
  Candidate360RepositoryPage,
  Candidate360RepositoryPort,
  CandidateDocumentContentAccess,
  CandidateDocumentRepositoryQuery,
  CandidateRecommenderRepositoryQuery,
  DuplicateCandidateRepositoryQuery,
  LinkRecommenderCommand,
  MergeCandidateCommand,
  ReviewDocumentCommand,
} from "../ports.js";

export interface PostgresCandidate360RepositoryOptions {
  readonly auditPolicyVersion?: string;
}

interface DuplicateCandidateRow {
  id: string;
  left_person_id: string;
  left_display_name: string;
  left_profile_state: string;
  left_has_employee_identity: boolean;
  right_person_id: string;
  right_display_name: string;
  right_profile_state: string;
  right_has_employee_identity: boolean;
  match_reasons: unknown;
  confidence: number | string;
  state: string;
  active_merge_id: string | null;
  version: number | string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface MergeLockRow {
  id: string;
  left_person_id: string;
  right_person_id: string;
  state: string;
  version: number | string;
}

interface CandidateProfileLockRow {
  profile_id: string;
  profile_version: number | string;
}

interface DocumentLockRow {
  id: string;
  person_id: string;
  document_kind: string;
  review_state: string;
  version: number | string;
  upload_id: string | null;
}

interface CandidateDocumentRow {
  id: string;
  person_id: string;
  case_id: string | null;
  document_kind: string;
  review_state: string;
  last_reviewed_by_user_account_id: string | null;
  last_reviewed_at: Date | string | null;
  provenance: unknown;
  version: number | string;
  created_at: Date | string;
  updated_at: Date | string;
  original_name: string | null;
  media_type: string | null;
  byte_size: number | string | null;
  sha256: string | null;
  scan_state: string | null;
}

interface CandidateRecommenderRow {
  id: string;
  candidate_person_id: string;
  recommender_person_id: string;
  recommender_display_name: string;
  relationship_type: string;
  state: string;
  version: number | string;
  linked_by_user_account_id: string;
  link_reason: string;
  provenance: unknown;
  linked_at: Date | string;
}

interface CandidateDocumentContentRow {
  id: string;
  storage_key: string | null;
  original_name: string | null;
  media_type: string | null;
  byte_size: number | string | null;
  sha256: string | null;
  scan_state: string | null;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toVersion(value: number | string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`Invalid aggregate version: ${value}`);
  return parsed;
}

function toConfidence(value: number | string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`Invalid duplicate confidence: ${value}`);
  }
  return parsed;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mapProvenance(value: unknown): Candidate360Provenance {
  if (!isObject(value)) return { origin: "migration" };
  const origin = value.origin;
  if (
    origin !== "manual" &&
    origin !== "integration" &&
    origin !== "migration" &&
    origin !== "dedup_engine"
  ) {
    return { origin: "migration" };
  }
  const sourceSystem = typeof value.sourceSystem === "string" ? value.sourceSystem : undefined;
  const sourceReference = typeof value.sourceReference === "string" ? value.sourceReference : undefined;
  const evidenceReferences = Array.isArray(value.evidenceReferences)
    ? value.evidenceReferences.filter((item): item is string => typeof item === "string")
    : undefined;
  return {
    origin,
    ...(sourceSystem ? { sourceSystem } : {}),
    ...(sourceReference ? { sourceReference } : {}),
    ...(evidenceReferences ? { evidenceReferences } : {}),
  };
}

function toOptionalSize(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > UPLOAD_STORAGE_CEILING_BYTES) {
    throw new Error(`Invalid candidate document byte size: ${value}`);
  }
  return parsed;
}

function contentState(scanState: string | null): CandidateDocumentContentState {
  switch (scanState) {
    case "clean":
      return "available";
    case "quarantined":
      return "scan_pending";
    case "rejected":
      return "rejected";
    case "scan_failed":
      return "scan_failed";
    default:
      return "external_unavailable";
  }
}

function mapDocument(row: CandidateDocumentRow): CandidateDocument {
  return {
    id: row.id,
    personId: row.person_id,
    caseId: row.case_id,
    documentKind: row.document_kind,
    originalName: row.original_name,
    mediaType: row.media_type,
    byteSize: toOptionalSize(row.byte_size),
    sha256: row.sha256,
    contentState: contentState(row.scan_state),
    reviewState: row.review_state as CandidateDocument["reviewState"],
    lastReviewedByUserAccountId: row.last_reviewed_by_user_account_id,
    lastReviewedAt: row.last_reviewed_at ? toIso(row.last_reviewed_at) : null,
    provenance: mapProvenance(row.provenance),
    version: toVersion(row.version),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapRecommender(row: CandidateRecommenderRow): CandidateRecommender {
  return {
    id: row.id,
    candidatePersonId: row.candidate_person_id,
    recommenderPersonId: row.recommender_person_id,
    recommenderDisplayName: row.recommender_display_name,
    relationshipType: row.relationship_type as CandidateRecommender["relationshipType"],
    state: row.state as CandidateRecommender["state"],
    version: toVersion(row.version),
    linkedByUserAccountId: row.linked_by_user_account_id,
    reason: row.link_reason,
    provenance: mapProvenance(row.provenance),
    linkedAt: toIso(row.linked_at),
  };
}

function uuidValues(values: readonly string[]): RawBuilder<unknown> {
  return sql.join(values.map((value) => sql`${value}::uuid`));
}

function employeeScopeSql(
  access: CrmAccessScope,
  employeeReference: RawBuilder<unknown>,
): RawBuilder<boolean> {
  if (access.visibility === "all") return sql<boolean>`true`;
  const predicates: RawBuilder<boolean>[] = [];
  if (access.employeeProfileIds.length > 0) {
    predicates.push(sql<boolean>`${employeeReference} in (${uuidValues(access.employeeProfileIds)})`);
  }
  if (access.organizationUnitIds.length > 0) {
    predicates.push(sql<boolean>`exists (
      select 1
      from identity.employee_profile candidate360_scope_employee
      where candidate360_scope_employee.id = ${employeeReference}
        and candidate360_scope_employee.archived_at is null
        and candidate360_scope_employee.organization_unit_id in (${uuidValues(access.organizationUnitIds)})
    )`);
  }
  return predicates.length > 0 ? sql<boolean>`(${sql.join(predicates, sql` or `)})` : sql<boolean>`false`;
}

/** SQL predicate used by every Candidate 360 read and mutation; post-load filtering is forbidden. */
export function candidate360PersonScopeSql(
  access: CrmAccessScope,
  personReference: RawBuilder<unknown>,
): RawBuilder<boolean> {
  if (access.visibility === "all") return sql<boolean>`true`;
  const assignmentScope = employeeScopeSql(
    access,
    sql.ref("candidate360_scope_assignment.employee_profile_id"),
  );
  return sql<boolean>`exists (
    select 1
    from crm.case_person candidate360_scope_link
    join crm."case" candidate360_scope_case on candidate360_scope_case.id = candidate360_scope_link.case_id
    join crm.case_assignment candidate360_scope_assignment
      on candidate360_scope_assignment.case_id = candidate360_scope_case.id
     and candidate360_scope_assignment.valid_to is null
     and candidate360_scope_assignment.archived_at is null
    where candidate360_scope_link.person_id = ${personReference}
      and candidate360_scope_case.archived_at is null
      and ${assignmentScope}
  )`;
}

/** A case-bound document is visible only through that exact case assignment. */
export function candidate360DocumentScopeSql(
  access: CrmAccessScope,
  personReference: RawBuilder<unknown>,
  caseReference: RawBuilder<unknown>,
): RawBuilder<boolean> {
  if (access.visibility === "all") return sql<boolean>`true`;
  const exactCaseAssignmentScope = employeeScopeSql(
    access,
    sql.ref("candidate360_document_assignment.employee_profile_id"),
  );
  const unboundPersonScope = candidate360PersonScopeSql(access, personReference);
  return sql<boolean>`(
    (
      ${caseReference} is not null
      and exists (
        select 1
        from crm."case" candidate360_document_case
        join crm.case_assignment candidate360_document_assignment
          on candidate360_document_assignment.case_id = candidate360_document_case.id
         and candidate360_document_assignment.valid_to is null
         and candidate360_document_assignment.archived_at is null
        where candidate360_document_case.id = ${caseReference}
          and candidate360_document_case.archived_at is null
          and ${exactCaseAssignmentScope}
      )
    )
    or (${caseReference} is null and ${unboundPersonScope})
  )`;
}

function mapDuplicate(row: DuplicateCandidateRow): DuplicateCandidate {
  const state = row.state as DuplicateCandidate["state"];
  return {
    id: row.id,
    left: {
      personId: row.left_person_id,
      displayName: row.left_display_name,
      profileState: row.left_profile_state,
      hasEmployeeIdentity: row.left_has_employee_identity,
    },
    right: {
      personId: row.right_person_id,
      displayName: row.right_display_name,
      profileState: row.right_profile_state,
      hasEmployeeIdentity: row.right_has_employee_identity,
    },
    matchReasons: stringArray(row.match_reasons),
    confidence: toConfidence(row.confidence),
    state,
    activeMergeId: row.active_merge_id,
    version: toVersion(row.version),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function scopeSnapshot(access: CrmAccessScope): Readonly<Record<string, unknown>> {
  return {
    visibility: access.visibility,
    employeeProfileIds: [...access.employeeProfileIds],
    organizationUnitIds: [...access.organizationUnitIds],
  };
}

async function appendOutbox(
  transaction: Transaction<Database>,
  input: {
    readonly topic: string;
    readonly aggregateType: string;
    readonly aggregateId: string;
    readonly aggregateVersion: number;
    readonly occurredAt: Date;
    readonly payload: Readonly<Record<string, unknown>>;
  },
): Promise<void> {
  const id = newUuid();
  const payload = JSON.stringify({
    ...input.payload,
    aggregateId: input.aggregateId,
    aggregateVersion: input.aggregateVersion,
    occurredAt: input.occurredAt.toISOString(),
  });
  await sql`
    insert into platform.outbox_event (
      id, topic, aggregate_type, aggregate_id, payload, idempotency_key,
      occurred_at, available_at, attempt_count
    ) values (
      ${id}::uuid,
      ${input.topic},
      ${input.aggregateType},
      ${input.aggregateId}::uuid,
      ${payload}::jsonb,
      ${`${input.topic}:${input.aggregateId}:v${input.aggregateVersion}`},
      ${input.occurredAt},
      ${input.occurredAt},
      0
    )
  `.execute(transaction);
}

async function appendCandidate360Audit(
  transaction: Transaction<Database>,
  input: {
    readonly eventType: string;
    readonly subjectType: string;
    readonly subjectId: string;
    readonly actorUserAccountId: string;
    readonly requestId: string;
    readonly reason: string;
    readonly beforeState: Readonly<Record<string, unknown>> | null;
    readonly afterState: Readonly<Record<string, unknown>>;
    readonly provenance: Candidate360Provenance;
    readonly access: CrmAccessScope;
    readonly occurredAt: Date;
    readonly policyVersion: string;
  },
): Promise<void> {
  await appendAuditEvent(transaction, {
    eventType: input.eventType,
    actorType: "user",
    actorId: input.actorUserAccountId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    requestId: input.requestId,
    reason: input.reason,
    beforeState: input.beforeState,
    afterState: input.afterState,
    metadata: { provenance: input.provenance },
    policyVersion: input.policyVersion,
    scopeSnapshot: scopeSnapshot(input.access),
    occurredAt: input.occurredAt,
  });
}

function isConcurrentMergeConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  const postgresError = error as { readonly code?: unknown; readonly constraint?: unknown };
  return (
    postgresError.code === "23505" &&
    (postgresError.constraint === "candidate_merge_active_duplicate_uidx" ||
      postgresError.constraint === "candidate_merge_active_merged_person_uidx")
  );
}

async function lockCandidateMergeParticipants(
  transaction: Transaction<Database>,
  personIds: readonly string[],
): Promise<void> {
  for (const personId of [...new Set(personIds)].sort()) {
    await sql`select pg_advisory_xact_lock(hashtextextended(${personId}, 360))`.execute(transaction);
  }
}

export class PostgresCandidate360Repository implements Candidate360RepositoryPort {
  private readonly auditPolicyVersion: string;

  constructor(
    private readonly db: Kysely<Database>,
    options: PostgresCandidate360RepositoryOptions = {},
  ) {
    this.auditPolicyVersion = options.auditPolicyVersion ?? "candidate360-command-policy-v1";
  }

  async listDuplicateCandidates(
    access: CrmAccessScope,
    query: DuplicateCandidateRepositoryQuery,
  ): Promise<Candidate360RepositoryPage<DuplicateCandidate>> {
    const leftScope = candidate360PersonScopeSql(access, sql.ref("left_person.id"));
    const rightScope = candidate360PersonScopeSql(access, sql.ref("right_person.id"));
    const personFilter = query.personId
      ? sql`and (dc.left_person_id = ${query.personId}::uuid or dc.right_person_id = ${query.personId}::uuid)`
      : sql``;
    const confidenceFilter =
      query.minimumConfidence === undefined ? sql`` : sql`and dc.confidence >= ${query.minimumConfidence}`;
    const cursorFilter = query.cursor
      ? sql`and (dc.created_at, dc.id) < (${new Date(query.cursor.createdAt)}, ${query.cursor.id}::uuid)`
      : sql``;

    const result = await sql<DuplicateCandidateRow>`
      select
        dc.id,
        dc.left_person_id,
        concat_ws(' ', left_person.surname, left_person.given_name, left_person.middle_name) as left_display_name,
        left_profile.profile_state as left_profile_state,
        exists (select 1 from identity.employee_profile ep where ep.person_id = left_person.id) as left_has_employee_identity,
        dc.right_person_id,
        concat_ws(' ', right_person.surname, right_person.given_name, right_person.middle_name) as right_display_name,
        right_profile.profile_state as right_profile_state,
        exists (select 1 from identity.employee_profile ep where ep.person_id = right_person.id) as right_has_employee_identity,
        dc.match_reasons,
        dc.confidence,
        dc.state,
        active_merge.id as active_merge_id,
        dc.version,
        dc.created_at,
        dc.updated_at
      from crm.duplicate_candidate dc
      join identity.person left_person on left_person.id = dc.left_person_id
      join crm.profile left_profile on left_profile.person_id = left_person.id
      join identity.person right_person on right_person.id = dc.right_person_id
      join crm.profile right_profile on right_profile.person_id = right_person.id
      left join crm.candidate_merge active_merge
        on active_merge.duplicate_candidate_id = dc.id and active_merge.state = 'active'
      where dc.archived_at is null
        and left_person.archived_at is null
        and left_profile.archived_at is null
        and right_person.archived_at is null
        and right_profile.archived_at is null
        and dc.state = ${query.state}
        and ${leftScope}
        and ${rightScope}
        ${personFilter}
        ${confidenceFilter}
        ${cursorFilter}
      order by dc.created_at desc, dc.id desc
      limit ${query.limit + 1}
    `.execute(this.db);

    const hasMore = result.rows.length > query.limit;
    const rows = result.rows.slice(0, query.limit);
    const last = rows.at(-1);
    return {
      items: rows.map(mapDuplicate),
      nextCursor: hasMore && last ? { createdAt: toIso(last.created_at), id: last.id } : null,
      hasMore,
    };
  }

  async listCandidateDocuments(
    access: CrmAccessScope,
    query: CandidateDocumentRepositoryQuery,
  ): Promise<Candidate360RepositoryPage<CandidateDocument>> {
    const scope = candidate360DocumentScopeSql(
      access,
      sql.ref("document.person_id"),
      sql.ref("document.case_id"),
    );
    const kindFilter = query.documentKind ? sql`and document.document_kind = ${query.documentKind}` : sql``;
    const reviewFilter = query.reviewState ? sql`and document.review_state = ${query.reviewState}` : sql``;
    const cursorFilter = query.cursor
      ? sql`and (document.created_at, document.id) < (${new Date(query.cursor.createdAt)}, ${query.cursor.id}::uuid)`
      : sql``;
    const result = await sql<CandidateDocumentRow>`
      select
        document.id,
        document.person_id,
        document.case_id,
        document.document_kind,
        document.review_state,
        document.last_reviewed_by_user_account_id,
        document.last_reviewed_at,
        document.provenance,
        document.version,
        document.created_at,
        document.updated_at,
        upload.original_name,
        upload.media_type,
        upload.byte_size,
        upload.sha256,
        upload.scan_state
      from crm.candidate_document document
      join identity.person document_person on document_person.id = document.person_id
      join crm.profile document_profile on document_profile.person_id = document_person.id
      left join intake.upload upload on upload.id = document.upload_id
      where document.person_id = ${query.personId}::uuid
        and document.archived_at is null
        and document_person.archived_at is null
        and document_profile.archived_at is null
        and document_profile.profile_state = 'active'
        and ${scope}
        ${kindFilter}
        ${reviewFilter}
        ${cursorFilter}
      order by document.created_at desc, document.id desc
      limit ${query.limit + 1}
    `.execute(this.db);

    const hasMore = result.rows.length > query.limit;
    const rows = result.rows.slice(0, query.limit);
    const last = rows.at(-1);
    return {
      items: rows.map(mapDocument),
      nextCursor: hasMore && last ? { createdAt: toIso(last.created_at), id: last.id } : null,
      hasMore,
    };
  }

  async getCandidateDocument(access: CrmAccessScope, documentId: string): Promise<CandidateDocument | null> {
    const scope = candidate360DocumentScopeSql(
      access,
      sql.ref("document.person_id"),
      sql.ref("document.case_id"),
    );
    const result = await sql<CandidateDocumentRow>`
      select
        document.id,
        document.person_id,
        document.case_id,
        document.document_kind,
        document.review_state,
        document.last_reviewed_by_user_account_id,
        document.last_reviewed_at,
        document.provenance,
        document.version,
        document.created_at,
        document.updated_at,
        upload.original_name,
        upload.media_type,
        upload.byte_size,
        upload.sha256,
        upload.scan_state
      from crm.candidate_document document
      join identity.person document_person on document_person.id = document.person_id
      join crm.profile document_profile on document_profile.person_id = document_person.id
      left join intake.upload upload on upload.id = document.upload_id
      where document.id = ${documentId}::uuid
        and document.archived_at is null
        and document_person.archived_at is null
        and document_profile.archived_at is null
        and document_profile.profile_state = 'active'
        and ${scope}
      limit 1
    `.execute(this.db);
    return result.rows[0] ? mapDocument(result.rows[0]) : null;
  }

  async listCandidateRecommenders(
    access: CrmAccessScope,
    query: CandidateRecommenderRepositoryQuery,
  ): Promise<Candidate360RepositoryPage<CandidateRecommender>> {
    const candidateScope = candidate360PersonScopeSql(access, sql.ref("candidate_person.id"));
    const recommenderScope = candidate360PersonScopeSql(access, sql.ref("recommender_person.id"));
    const cursorFilter = query.cursor
      ? sql`and (link.linked_at, link.id) < (${new Date(query.cursor.createdAt)}, ${query.cursor.id}::uuid)`
      : sql``;
    const result = await sql<CandidateRecommenderRow>`
      select
        link.id,
        link.candidate_person_id,
        link.recommender_person_id,
        concat_ws(' ', recommender_person.surname, recommender_person.given_name, recommender_person.middle_name)
          as recommender_display_name,
        link.relationship_type,
        link.state,
        link.version,
        link.linked_by_user_account_id,
        link.link_reason,
        link.provenance,
        link.linked_at
      from crm.candidate_recommender_link link
      join identity.person candidate_person on candidate_person.id = link.candidate_person_id
      join crm.profile candidate_profile on candidate_profile.person_id = candidate_person.id
      join identity.person recommender_person on recommender_person.id = link.recommender_person_id
      join crm.profile recommender_profile on recommender_profile.person_id = recommender_person.id
      where link.candidate_person_id = ${query.candidatePersonId}::uuid
        and link.state = ${query.state}
        and candidate_person.archived_at is null
        and candidate_profile.archived_at is null
        and candidate_profile.profile_state = 'active'
        and recommender_person.archived_at is null
        and recommender_profile.archived_at is null
        and recommender_profile.profile_state = 'active'
        and ${candidateScope}
        and ${recommenderScope}
        ${cursorFilter}
      order by link.linked_at desc, link.id desc
      limit ${query.limit + 1}
    `.execute(this.db);

    const hasMore = result.rows.length > query.limit;
    const rows = result.rows.slice(0, query.limit);
    const last = rows.at(-1);
    return {
      items: rows.map(mapRecommender),
      nextCursor: hasMore && last ? { createdAt: toIso(last.linked_at), id: last.id } : null,
      hasMore,
    };
  }

  async getCandidateDocumentContentAccess(
    access: CrmAccessScope,
    documentId: string,
  ): Promise<CandidateDocumentContentAccess> {
    const scope = candidate360DocumentScopeSql(
      access,
      sql.ref("document.person_id"),
      sql.ref("document.case_id"),
    );
    const result = await sql<CandidateDocumentContentRow>`
      select
        document.id,
        upload.storage_key,
        upload.original_name,
        upload.media_type,
        upload.byte_size,
        upload.sha256,
        upload.scan_state
      from crm.candidate_document document
      join identity.person document_person on document_person.id = document.person_id
      join crm.profile document_profile on document_profile.person_id = document_person.id
      left join intake.upload upload on upload.id = document.upload_id
      where document.id = ${documentId}::uuid
        and document.archived_at is null
        and document_person.archived_at is null
        and document_profile.archived_at is null
        and document_profile.profile_state = 'active'
        and ${scope}
      limit 1
    `.execute(this.db);
    const row = result.rows[0];
    if (!row) return { kind: "not_found" };
    const state = contentState(row.scan_state);
    if (state !== "available") return { kind: "blocked", state };
    const byteSize = toOptionalSize(row.byte_size);
    if (
      !row.storage_key ||
      !row.original_name ||
      !row.media_type ||
      byteSize === null ||
      !row.sha256 ||
      !/^[a-f0-9]{64}$/u.test(row.sha256)
    ) {
      return { kind: "blocked", state: "external_unavailable" };
    }
    return {
      kind: "ready",
      documentId: row.id,
      storageKey: row.storage_key,
      originalName: row.original_name,
      mediaType: row.media_type,
      byteSize,
      sha256: row.sha256,
    };
  }

  async recordCandidateDocumentContentAccess(
    actor: CrmActorContext,
    access: CrmAccessScope,
    documentId: string,
  ): Promise<boolean> {
    return this.db.transaction().execute(async (transaction) => {
      const scope = candidate360DocumentScopeSql(
        access,
        sql.ref("document.person_id"),
        sql.ref("document.case_id"),
      );
      const result = await sql<{ id: string }>`
        select document.id
        from crm.candidate_document document
        join identity.person document_person on document_person.id = document.person_id
        join crm.profile document_profile on document_profile.person_id = document_person.id
        join intake.upload upload on upload.id = document.upload_id
        where document.id = ${documentId}::uuid
          and document.archived_at is null
          and document_person.archived_at is null
          and document_profile.archived_at is null
          and document_profile.profile_state = 'active'
          and upload.scan_state = 'clean'
          and ${scope}
        for share of document, upload
      `.execute(transaction);
      if (!result.rows[0]) return false;
      await appendAuditEvent(transaction, {
        eventType: "candidate360.document.content_accessed",
        actorType: "user",
        actorId: actor.userAccountId,
        subjectType: "candidate_document",
        subjectId: documentId,
        requestId: actor.requestId,
        metadata: {},
        policyVersion: this.auditPolicyVersion,
        scopeSnapshot: scopeSnapshot(access),
        occurredAt: new Date(),
      });
      return true;
    });
  }

  async mergeCandidate(
    command: MergeCandidateCommand,
  ): Promise<Candidate360MutationResult<MergeCandidateResult>> {
    try {
      return await this.db.transaction().execute(async (transaction) => {
        const leftScope = candidate360PersonScopeSql(command.access, sql.ref("left_person.id"));
        const rightScope = candidate360PersonScopeSql(command.access, sql.ref("right_person.id"));
        const duplicateResult = await sql<MergeLockRow>`
          select dc.id, dc.left_person_id, dc.right_person_id, dc.state, dc.version
          from crm.duplicate_candidate dc
          join identity.person left_person on left_person.id = dc.left_person_id
          join crm.profile left_profile on left_profile.person_id = left_person.id
          join identity.person right_person on right_person.id = dc.right_person_id
          join crm.profile right_profile on right_profile.person_id = right_person.id
          where dc.id = ${command.duplicateCandidateId}::uuid
            and dc.archived_at is null
            and left_person.archived_at is null
            and left_profile.archived_at is null
            and right_person.archived_at is null
            and right_profile.archived_at is null
            and ${leftScope}
            and ${rightScope}
          for update of dc
        `.execute(transaction);
        const duplicate = duplicateResult.rows[0];
        if (!duplicate) return { kind: "not_found" } as const;

        const currentVersion = toVersion(duplicate.version);
        if (currentVersion !== command.expectedVersion) {
          return { kind: "version_conflict", currentVersion } as const;
        }
        if (duplicate.state !== "open") {
          return { kind: "state_conflict", currentState: duplicate.state, currentVersion } as const;
        }
        if (
          command.survivorPersonId !== duplicate.left_person_id &&
          command.survivorPersonId !== duplicate.right_person_id
        ) {
          return { kind: "invalid_survivor" } as const;
        }
        const mergedPersonId =
          command.survivorPersonId === duplicate.left_person_id
            ? duplicate.right_person_id
            : duplicate.left_person_id;

        // Different duplicate rows can overlap on a person. Deterministic participant locks
        // prevent concurrent commands from creating a merge chain around that person.
        await lockCandidateMergeParticipants(transaction, [command.survivorPersonId, mergedPersonId]);

        const employeeIdentities = await sql<{ person_id: string }>`
          select employee.person_id
          from identity.employee_profile employee
          where employee.person_id in (${command.survivorPersonId}::uuid, ${mergedPersonId}::uuid)
        `.execute(transaction);
        if (employeeIdentities.rows.length > 0) {
          return {
            kind: "employee_identity_conflict",
            personIds: employeeIdentities.rows.map((row) => row.person_id),
          } as const;
        }

        const mergeConflict = await sql<{ id: string }>`
          select candidate_merge.id
          from crm.candidate_merge candidate_merge
          where candidate_merge.state = 'active'
            and (
              candidate_merge.merged_person_id in (${command.survivorPersonId}::uuid, ${mergedPersonId}::uuid)
              or candidate_merge.survivor_person_id = ${mergedPersonId}::uuid
            )
          limit 1
        `.execute(transaction);
        if (mergeConflict.rows[0]) {
          return { kind: "state_conflict", currentState: "active_merge_exists", currentVersion } as const;
        }

        const mergeId = newUuid();
        const historyId = newUuid();
        const occurredAt = new Date();
        const provenanceJson = JSON.stringify(command.provenance);
        await sql`
          insert into crm.candidate_merge (
            id, duplicate_candidate_id, survivor_person_id, merged_person_id, state,
            reviewed_by_user_account_id, merge_reason, merge_provenance, merged_at
          ) values (
            ${mergeId}::uuid,
            ${duplicate.id}::uuid,
            ${command.survivorPersonId}::uuid,
            ${mergedPersonId}::uuid,
            'active',
            ${command.actor.userAccountId}::uuid,
            ${command.reason},
            ${provenanceJson}::jsonb,
            ${occurredAt}
          )
        `.execute(transaction);
        await sql`
          insert into crm.candidate_merge_history (
            id, candidate_merge_id, event_type, actor_user_account_id, reason,
            provenance, aggregate_version, occurred_at
          ) values (
            ${historyId}::uuid,
            ${mergeId}::uuid,
            'merged',
            ${command.actor.userAccountId}::uuid,
            ${command.reason},
            ${provenanceJson}::jsonb,
            1,
            ${occurredAt}
          )
        `.execute(transaction);
        const updateResult = await sql<{ version: number | string }>`
          update crm.duplicate_candidate
          set state = 'confirmed_duplicate',
              resolution = jsonb_build_object(
                'mergeId', ${mergeId}::text,
                'survivorPersonId', ${command.survivorPersonId}::text,
                'mergedPersonId', ${mergedPersonId}::text,
                'reversible', true
              ),
              reviewed_by = ${command.actor.userAccountId}::uuid,
              reviewed_at = ${occurredAt}
          where id = ${duplicate.id}::uuid and version = ${command.expectedVersion} and state = 'open'
          returning version
        `.execute(transaction);
        const updated = updateResult.rows[0];
        if (!updated) return { kind: "version_conflict", currentVersion } as const;
        const duplicateVersion = toVersion(updated.version);

        const afterState = {
          duplicateCandidateId: duplicate.id,
          survivorPersonId: command.survivorPersonId,
          mergedPersonId,
          state: "active",
          reversible: true,
          mergeVersion: 1,
          duplicateVersion,
        } as const;
        await appendCandidate360Audit(transaction, {
          eventType: "candidate360.candidate.merged",
          subjectType: "candidate_merge",
          subjectId: mergeId,
          actorUserAccountId: command.actor.userAccountId,
          requestId: command.actor.requestId,
          reason: command.reason,
          beforeState: { duplicateState: "open", duplicateVersion: currentVersion },
          afterState,
          provenance: command.provenance,
          access: command.access,
          occurredAt,
          policyVersion: this.auditPolicyVersion,
        });
        await appendOutbox(transaction, {
          topic: "candidate360.candidate.merged.v1",
          aggregateType: "candidate_merge",
          aggregateId: mergeId,
          aggregateVersion: 1,
          occurredAt,
          payload: afterState,
        });

        return {
          kind: "succeeded",
          value: {
            mergeId,
            duplicateCandidateId: duplicate.id,
            survivorPersonId: command.survivorPersonId,
            mergedPersonId,
            state: "active",
            reversible: true,
            mergeVersion: 1,
            duplicateVersion,
            reviewedByUserAccountId: command.actor.userAccountId,
            reason: command.reason,
            provenance: command.provenance,
            mergedAt: occurredAt.toISOString(),
          },
        } as const;
      });
    } catch (error) {
      if (isConcurrentMergeConflict(error)) {
        return {
          kind: "state_conflict",
          currentState: "active_merge_exists",
          currentVersion: command.expectedVersion,
        };
      }
      throw error;
    }
  }

  async linkRecommender(
    command: LinkRecommenderCommand,
  ): Promise<Candidate360MutationResult<RecommenderLink>> {
    return this.db.transaction().execute(async (transaction) => {
      const candidateScope = candidate360PersonScopeSql(command.access, sql.ref("candidate_person.id"));
      const candidateResult = await sql<CandidateProfileLockRow>`
        select candidate_profile.id as profile_id, candidate_profile.version as profile_version
        from crm.profile candidate_profile
        join identity.person candidate_person on candidate_person.id = candidate_profile.person_id
        where candidate_person.id = ${command.candidatePersonId}::uuid
          and candidate_person.archived_at is null
          and candidate_profile.archived_at is null
          and candidate_profile.profile_state = 'active'
          and ${candidateScope}
        for update of candidate_profile
      `.execute(transaction);
      const candidate = candidateResult.rows[0];
      if (!candidate) return { kind: "not_found" } as const;
      const currentVersion = toVersion(candidate.profile_version);
      if (currentVersion !== command.expectedCandidateVersion) {
        return { kind: "version_conflict", currentVersion } as const;
      }

      const recommenderScope = candidate360PersonScopeSql(command.access, sql.ref("recommender_person.id"));
      const recommender = await sql<{ id: string }>`
        select recommender_person.id
        from identity.person recommender_person
        join crm.profile recommender_profile on recommender_profile.person_id = recommender_person.id
        where recommender_person.id = ${command.recommenderPersonId}::uuid
          and recommender_person.archived_at is null
          and recommender_profile.archived_at is null
          and recommender_profile.profile_state = 'active'
          and ${recommenderScope}
        limit 1
      `.execute(transaction);
      if (!recommender.rows[0]) return { kind: "not_found" } as const;

      const existing = await sql<{ id: string; version: number | string }>`
        select link.id, link.version
        from crm.candidate_recommender_link link
        where link.candidate_person_id = ${command.candidatePersonId}::uuid
          and link.recommender_person_id = ${command.recommenderPersonId}::uuid
          and link.relationship_type = ${command.relationshipType}
          and link.state = 'active'
        limit 1
      `.execute(transaction);
      const existingLink = existing.rows[0];
      if (existingLink) {
        return {
          kind: "already_linked",
          linkId: existingLink.id,
          currentVersion: toVersion(existingLink.version),
        } as const;
      }

      const linkId = newUuid();
      const historyId = newUuid();
      const occurredAt = new Date();
      const provenanceJson = JSON.stringify(command.provenance);
      await sql`
        insert into crm.candidate_recommender_link (
          id, candidate_person_id, recommender_person_id, relationship_type, state,
          linked_by_user_account_id, link_reason, provenance, linked_at
        ) values (
          ${linkId}::uuid,
          ${command.candidatePersonId}::uuid,
          ${command.recommenderPersonId}::uuid,
          ${command.relationshipType},
          'active',
          ${command.actor.userAccountId}::uuid,
          ${command.reason},
          ${provenanceJson}::jsonb,
          ${occurredAt}
        )
      `.execute(transaction);
      await sql`
        insert into crm.candidate_recommender_link_history (
          id, candidate_recommender_link_id, event_type, actor_user_account_id,
          reason, provenance, aggregate_version, occurred_at
        ) values (
          ${historyId}::uuid,
          ${linkId}::uuid,
          'linked',
          ${command.actor.userAccountId}::uuid,
          ${command.reason},
          ${provenanceJson}::jsonb,
          1,
          ${occurredAt}
        )
      `.execute(transaction);
      const updateResult = await sql<{ version: number | string }>`
        update crm.profile
        set updated_at = clock_timestamp()
        where id = ${candidate.profile_id}::uuid and version = ${command.expectedCandidateVersion}
        returning version
      `.execute(transaction);
      const updated = updateResult.rows[0];
      if (!updated) return { kind: "version_conflict", currentVersion } as const;
      const candidateVersion = toVersion(updated.version);

      const afterState = {
        candidatePersonId: command.candidatePersonId,
        recommenderPersonId: command.recommenderPersonId,
        relationshipType: command.relationshipType,
        state: "active",
        linkVersion: 1,
        candidateVersion,
      } as const;
      await appendCandidate360Audit(transaction, {
        eventType: "candidate360.recommender.linked",
        subjectType: "candidate_recommender_link",
        subjectId: linkId,
        actorUserAccountId: command.actor.userAccountId,
        requestId: command.actor.requestId,
        reason: command.reason,
        beforeState: null,
        afterState,
        provenance: command.provenance,
        access: command.access,
        occurredAt,
        policyVersion: this.auditPolicyVersion,
      });
      await appendOutbox(transaction, {
        topic: "candidate360.recommender.linked.v1",
        aggregateType: "candidate_recommender_link",
        aggregateId: linkId,
        aggregateVersion: 1,
        occurredAt,
        payload: afterState,
      });

      return {
        kind: "succeeded",
        value: {
          id: linkId,
          candidatePersonId: command.candidatePersonId,
          recommenderPersonId: command.recommenderPersonId,
          relationshipType: command.relationshipType,
          state: "active",
          version: 1,
          candidateVersion,
          linkedByUserAccountId: command.actor.userAccountId,
          reason: command.reason,
          provenance: command.provenance,
          linkedAt: occurredAt.toISOString(),
        },
      } as const;
    });
  }

  async reviewDocument(
    command: ReviewDocumentCommand,
  ): Promise<Candidate360MutationResult<CandidateDocumentReviewResult>> {
    return this.db.transaction().execute(async (transaction) => {
      const documentScope = candidate360DocumentScopeSql(
        command.access,
        sql.ref("document_person.id"),
        sql.ref("document.case_id"),
      );
      const documentResult = await sql<DocumentLockRow>`
        select
          document.id,
          document.person_id,
          document.document_kind,
          document.review_state,
          document.version,
          document.upload_id
        from crm.candidate_document document
        join identity.person document_person on document_person.id = document.person_id
        join crm.profile document_profile on document_profile.person_id = document_person.id
        where document.id = ${command.documentId}::uuid
          and document.archived_at is null
          and document_person.archived_at is null
          and document_profile.archived_at is null
          and ${documentScope}
        for update of document
      `.execute(transaction);
      const document = documentResult.rows[0];
      if (!document) return { kind: "not_found" } as const;
      const currentVersion = toVersion(document.version);
      if (currentVersion !== command.expectedVersion) {
        return { kind: "version_conflict", currentVersion } as const;
      }
      const uploadResult = document.upload_id
        ? await sql<{ scan_state: string }>`
            select scan_state
            from intake.upload
            where id = ${document.upload_id}::uuid
            for update
          `.execute(transaction)
        : null;
      const scanState = uploadResult?.rows[0]?.scan_state ?? "content_unavailable";
      if (scanState !== "clean") {
        return {
          kind: "scan_not_clean",
          scanState,
          currentVersion,
        } as const;
      }
      if (
        ["approved", "rejected"].includes(document.review_state) ||
        document.review_state === command.decision
      ) {
        return {
          kind: "state_conflict",
          currentState: document.review_state,
          currentVersion,
        } as const;
      }

      const reviewId = newUuid();
      const occurredAt = new Date();
      const provenanceJson = JSON.stringify(command.provenance);
      const updateResult = await sql<{ version: number | string }>`
        update crm.candidate_document
        set review_state = ${command.decision},
            last_reviewed_by_user_account_id = ${command.actor.userAccountId}::uuid,
            last_reviewed_at = ${occurredAt}
        where id = ${document.id}::uuid and version = ${command.expectedVersion}
        returning version
      `.execute(transaction);
      const updated = updateResult.rows[0];
      if (!updated) return { kind: "version_conflict", currentVersion } as const;
      const version = toVersion(updated.version);
      await sql`
        insert into crm.candidate_document_review (
          id, candidate_document_id, from_state, to_state, reviewer_user_account_id,
          reason, provenance, aggregate_version, occurred_at
        ) values (
          ${reviewId}::uuid,
          ${document.id}::uuid,
          ${document.review_state},
          ${command.decision},
          ${command.actor.userAccountId}::uuid,
          ${command.reason},
          ${provenanceJson}::jsonb,
          ${version},
          ${occurredAt}
        )
      `.execute(transaction);

      const afterState = {
        documentId: document.id,
        personId: document.person_id,
        documentKind: document.document_kind,
        previousState: document.review_state,
        reviewState: command.decision,
        version,
      } as const;
      await appendCandidate360Audit(transaction, {
        eventType: "candidate360.document.reviewed",
        subjectType: "candidate_document",
        subjectId: document.id,
        actorUserAccountId: command.actor.userAccountId,
        requestId: command.actor.requestId,
        reason: command.reason,
        beforeState: { reviewState: document.review_state, version: currentVersion },
        afterState,
        provenance: command.provenance,
        access: command.access,
        occurredAt,
        policyVersion: this.auditPolicyVersion,
      });
      await appendOutbox(transaction, {
        topic: "candidate360.document.reviewed.v1",
        aggregateType: "candidate_document",
        aggregateId: document.id,
        aggregateVersion: version,
        occurredAt,
        payload: afterState,
      });

      return {
        kind: "succeeded",
        value: {
          documentId: document.id,
          personId: document.person_id,
          documentKind: document.document_kind,
          previousState: document.review_state as CandidateDocumentReviewResult["previousState"],
          reviewState: command.decision,
          version,
          reviewerUserAccountId: command.actor.userAccountId,
          reason: command.reason,
          provenance: command.provenance,
          reviewedAt: occurredAt.toISOString(),
        },
      } as const;
    });
  }
}
