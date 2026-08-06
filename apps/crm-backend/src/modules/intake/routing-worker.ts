import { type Kysely, sql, type Transaction } from "kysely";
import { newPublicId, newUuid } from "../../common/id.js";
import type { Database } from "../../db/types.js";
import { appendAuditEvent } from "../platform/audit.js";
import type { NormalizedApplicationInput } from "./ports.js";

const CONSUMER = "crm-intake-router-v1";
const TOPIC = "intake.application.received.v1";

interface ClaimedEvent {
  readonly id: string;
  readonly aggregate_id: string;
  readonly payload: unknown;
  readonly attempt_count: number;
}

export interface IntakeRoutingWorkerOptions {
  readonly batchSize: number;
  readonly lockTtlSeconds: number;
  readonly workerId: string;
}

export interface IntakeRoutingBatchResult {
  readonly claimed: number;
  readonly routed: number;
  readonly needsReview: number;
  readonly failed: number;
}

type RoutingOutcome = "routed" | "needs_review" | "replayed";

export interface CandidateIdentityRow {
  readonly id: string;
  readonly surname: string;
  readonly given_name: string;
  readonly middle_name: string | null;
  readonly birth_date: Date | string | null;
  readonly normalized_email: string | null;
  readonly normalized_phone: string | null;
  readonly person_archived_at: Date | null;
  readonly profile_id: string | null;
  readonly profile_archived_at: Date | null;
  readonly has_employee_profile: boolean;
  readonly has_user_account: boolean;
}

export type CandidateIdentityMatch =
  | { readonly kind: "new" }
  | { readonly kind: "reuse"; readonly personId: string; readonly profileId: string }
  | { readonly kind: "needs_review"; readonly reasonCode: "INTAKE_IDENTITY_MATCH_REQUIRES_REVIEW" };

function normalizedName(value: string | null): string {
  return (value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("ru-RU");
}

function dateOnly(value: Date | string | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

export function classifyCandidateIdentity(
  rows: readonly CandidateIdentityRow[],
  personal: NormalizedApplicationInput["personal"],
): CandidateIdentityMatch {
  if (rows.length === 0) {
    return { kind: "new" };
  }
  const distinctPeople = [...new Set(rows.map((row) => row.id))];
  if (distinctPeople.length !== 1 || rows.length !== 1) {
    return { kind: "needs_review", reasonCode: "INTAKE_IDENTITY_MATCH_REQUIRES_REVIEW" };
  }

  const candidate = rows[0];
  if (!candidate) {
    return { kind: "new" };
  }
  const fullIdentityMatch =
    candidate.normalized_email?.toLocaleLowerCase("en-US") === personal.email &&
    candidate.normalized_phone === personal.phoneE164 &&
    normalizedName(candidate.surname) === normalizedName(personal.surname) &&
    normalizedName(candidate.given_name) === normalizedName(personal.name) &&
    normalizedName(candidate.middle_name) === normalizedName(personal.middlename) &&
    dateOnly(candidate.birth_date) === personal.birthdate;
  const isReusableCandidate =
    fullIdentityMatch &&
    candidate.person_archived_at === null &&
    candidate.profile_id !== null &&
    candidate.profile_archived_at === null &&
    !candidate.has_employee_profile &&
    !candidate.has_user_account;

  return isReusableCandidate
    ? { kind: "reuse", personId: candidate.id, profileId: candidate.profile_id as string }
    : { kind: "needs_review", reasonCode: "INTAKE_IDENTITY_MATCH_REQUIRES_REVIEW" };
}

async function acquireAdvisoryLocks(
  transaction: Transaction<Database>,
  lockKeys: readonly string[],
): Promise<void> {
  for (const lockKey of [...new Set(lockKeys)].sort()) {
    await sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`.execute(transaction);
  }
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asNormalizedApplication(value: unknown): NormalizedApplicationInput | null {
  if (!isObject(value) || !isObject(value.personal) || !isObject(value.application)) {
    return null;
  }
  const personal = value.personal;
  const application = value.application;
  if (
    typeof value.schemaVersion !== "string" ||
    typeof personal.surname !== "string" ||
    typeof personal.name !== "string" ||
    typeof personal.birthdate !== "string" ||
    typeof personal.email !== "string" ||
    typeof personal.phoneE164 !== "string" ||
    (application.applicantType !== "relocation" && application.applicantType !== "student") ||
    !isObject(value.meta) ||
    !isObject(value.consent) ||
    !isObject(value.attachments)
  ) {
    return null;
  }
  return value as unknown as NormalizedApplicationInput;
}

function safeErrorCode(error: unknown): string {
  if (isObject(error) && typeof error.code === "string" && /^[A-Za-z0-9_]{1,64}$/u.test(error.code)) {
    return error.code.toUpperCase();
  }
  return "INTAKE_ROUTING_FAILED";
}

export class IntakeRoutingWorker {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly options: IntakeRoutingWorkerOptions,
  ) {}

  async runBatch(signal?: AbortSignal): Promise<IntakeRoutingBatchResult> {
    let claimed = 0;
    let routed = 0;
    let needsReview = 0;
    let failed = 0;

    for (let index = 0; index < this.options.batchSize && !signal?.aborted; index += 1) {
      const event = await this.claimNext();
      if (!event) {
        break;
      }
      claimed += 1;
      try {
        const outcome = await this.processClaimed(event);
        if (outcome === "routed") {
          routed += 1;
        } else if (outcome === "needs_review") {
          needsReview += 1;
        }
      } catch (error) {
        failed += 1;
        await this.releaseAfterFailure(event, safeErrorCode(error));
      }
    }

    return { claimed, routed, needsReview, failed };
  }

  private async claimNext(): Promise<ClaimedEvent | null> {
    const result = await sql<ClaimedEvent>`
      WITH candidate AS (
        SELECT id
        FROM platform.outbox_event
        WHERE topic = ${TOPIC}
          AND delivered_at IS NULL
          AND available_at <= clock_timestamp()
          AND (
            locked_at IS NULL
            OR locked_at < clock_timestamp() - make_interval(secs => ${this.options.lockTtlSeconds})
          )
        ORDER BY occurred_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE platform.outbox_event AS event
      SET locked_at = clock_timestamp(),
          locked_by = ${this.options.workerId},
          attempt_count = event.attempt_count + 1,
          last_error_code = NULL
      FROM candidate
      WHERE event.id = candidate.id
      RETURNING event.id, event.aggregate_id, event.payload, event.attempt_count
    `.execute(this.db);
    return result.rows[0] ?? null;
  }

  private async processClaimed(event: ClaimedEvent): Promise<RoutingOutcome> {
    return this.db.transaction().execute(async (transaction) => {
      const lockedEvent = await transaction
        .selectFrom("platform.outbox_event")
        .select(["id", "aggregate_id", "payload", "delivered_at", "locked_by"])
        .where("id", "=", event.id)
        .forUpdate()
        .executeTakeFirst();
      if (!lockedEvent || lockedEvent.delivered_at || lockedEvent.locked_by !== this.options.workerId) {
        return "replayed";
      }

      const prior = await transaction
        .selectFrom("platform.inbox_event")
        .select("event_id")
        .where("consumer", "=", CONSUMER)
        .where("event_id", "=", event.id)
        .executeTakeFirst();
      if (prior) {
        await this.markDelivered(transaction, event.id);
        return "replayed";
      }

      const submission = await transaction
        .selectFrom("intake.submission")
        .selectAll()
        .where("id", "=", lockedEvent.aggregate_id)
        .forUpdate()
        .executeTakeFirst();
      if (!submission) {
        throw Object.assign(new Error("Intake submission is missing"), {
          code: "INTAKE_SUBMISSION_MISSING",
        });
      }
      if (submission.status === "routed" && submission.routed_case_id) {
        await this.finishEvent(transaction, event.id, {
          outcome: "replayed",
          caseId: submission.routed_case_id,
        });
        return "replayed";
      }

      const input = asNormalizedApplication(submission.payload);
      if (!input) {
        await this.markNeedsReview(transaction, event.id, submission.id, "INTAKE_PAYLOAD_CONTRACT_DRIFT");
        return "needs_review";
      }

      const sourceUpload = await transaction
        .selectFrom("intake.upload")
        .select(["id", "public_id"])
        .where("linked_submission_id", "=", submission.id)
        .where("public_id", "=", input.attachments.resumeFileId)
        .executeTakeFirst();
      if (!sourceUpload) {
        await this.markNeedsReview(transaction, event.id, submission.id, "INTAKE_RESUME_UPLOAD_MISSING");
        return "needs_review";
      }

      await acquireAdvisoryLocks(transaction, [
        `intake-identity-email:${input.personal.email}`,
        `intake-identity-phone:${input.personal.phoneE164}`,
      ]);

      // Match across every identity person first. A partial contact match, a conflicting name/DOB,
      // or an employee/account identity is never converted into a candidate automatically.
      const candidates = await transaction
        .selectFrom("identity.person as person")
        .leftJoin("crm.profile as profile", "profile.person_id", "person.id")
        .select([
          "person.id",
          "person.surname",
          "person.given_name",
          "person.middle_name",
          "person.birth_date",
          "person.normalized_email",
          "person.normalized_phone",
          "person.archived_at as person_archived_at",
          "profile.id as profile_id",
          "profile.archived_at as profile_archived_at",
          sql<boolean>`identity.person_has_employee_profile(person.id)`.as("has_employee_profile"),
          sql<boolean>`identity.person_has_user_account(person.id)`.as("has_user_account"),
        ])
        .where((expression) =>
          expression.or([
            expression("person.normalized_email", "=", input.personal.email),
            expression("person.normalized_phone", "=", input.personal.phoneE164),
          ]),
        )
        .limit(3)
        .execute();
      const identityMatch = classifyCandidateIdentity(candidates, input.personal);
      if (identityMatch.kind === "needs_review") {
        await this.markNeedsReview(transaction, event.id, submission.id, identityMatch.reasonCode);
        return "needs_review";
      }

      const now = new Date();
      const personId = identityMatch.kind === "reuse" ? identityMatch.personId : newUuid();
      if (identityMatch.kind === "new") {
        await transaction
          .insertInto("identity.person")
          .values({
            id: personId,
            surname: input.personal.surname,
            given_name: input.personal.name,
            middle_name: input.personal.middlename,
            birth_date: input.personal.birthdate,
            normalized_email: input.personal.email,
            normalized_phone: input.personal.phoneE164,
            updated_at: now,
            archived_at: null,
          })
          .execute();
      }

      let profile = await transaction
        .selectFrom("crm.profile")
        .select(["id", "archived_at"])
        .where("person_id", "=", personId)
        .executeTakeFirst();
      if (profile?.archived_at) {
        await this.markNeedsReview(transaction, event.id, submission.id, "INTAKE_PROFILE_ARCHIVED");
        return "needs_review";
      }
      if (!profile) {
        const profileId = newUuid();
        await transaction
          .insertInto("crm.profile")
          .values({
            id: profileId,
            person_id: personId,
            profile_state: "active",
            data_quality_state: "verified",
            updated_at: now,
            archived_at: null,
          })
          .execute();
        profile = { id: profileId, archived_at: null };
      }

      await acquireAdvisoryLocks(transaction, [
        `crm-open-case:${profile.id}:${input.application.applicantType}`,
      ]);
      const existingOpenCase = await transaction
        .selectFrom("crm.case as existing_case")
        .innerJoin(
          "crm.program_participation as existing_participation",
          "existing_participation.id",
          "existing_case.participation_id",
        )
        .select("existing_case.id")
        .where("existing_participation.crm_profile_id", "=", profile.id)
        .where("existing_participation.program_type", "=", input.application.applicantType)
        .where("existing_participation.archived_at", "is", null)
        .where("existing_case.archived_at", "is", null)
        .where("existing_case.status", "in", ["open", "needs_review"])
        .limit(1)
        .executeTakeFirst();
      if (existingOpenCase) {
        await this.markNeedsReview(transaction, event.id, submission.id, "INTAKE_OPEN_CASE_EXISTS_FOR_ROUTE");
        return "needs_review";
      }

      const participationId = newUuid();
      await transaction
        .insertInto("crm.program_participation")
        .values({
          id: participationId,
          crm_profile_id: profile.id,
          program_type: input.application.applicantType,
          status: "active",
          started_at: now,
          ended_at: null,
          updated_at: now,
          archived_at: null,
        })
        .execute();

      await transaction
        .insertInto("crm.candidate_source")
        .values({
          id: newUuid(),
          crm_profile_id: profile.id,
          submission_id: submission.id,
          source_code: input.meta.source,
          entry_point_code: input.meta.entryPoint.code,
          vacancy_id: input.application.vacancyId,
          first_touch: input.meta.firstTouch ?? {},
          last_touch: input.meta.lastTouch ?? {},
          consent_policy_version: input.consent.privacyPolicyVersion,
          consent_accepted_at: input.consent.acceptedAt ? new Date(input.consent.acceptedAt) : null,
          consent_evidence: { evidence: input.consent.evidence },
          updated_at: now,
          archived_at: null,
        })
        .execute();

      const caseId = newUuid();
      const casePublicId = newPublicId("case");
      const caseTitle =
        input.application.applicantType === "relocation"
          ? `${input.personal.surname} ${input.personal.name}: ${input.application.wishPost}`
          : `${input.personal.surname} ${input.personal.name}: ${input.application.studentProfile.specialty}`;
      await transaction
        .insertInto("crm.case")
        .values({
          id: caseId,
          public_id: casePublicId,
          participation_id: participationId,
          funnel_code: input.application.applicantType,
          funnel_version: 1,
          stage_code: "new",
          title: caseTitle,
          status: "open",
          next_step: null,
          source_created_at: submission.created_at,
          updated_at: now,
          archived_at: null,
        })
        .execute();
      await transaction
        .insertInto("crm.case_person")
        .values({
          case_id: caseId,
          person_id: personId,
          relationship_type: input.application.applicantType === "student" ? "student" : "candidate",
          is_primary: true,
        })
        .execute();

      const documentId = newUuid();
      const documentProvenance = JSON.stringify({
        origin: "integration",
        sourceSystem: "public-intake",
        sourceReference: submission.public_id,
      });
      await sql`
        insert into crm.candidate_document (
          id, person_id, case_id, upload_id, document_kind, storage_reference,
          review_state, provenance, created_at, updated_at
        ) values (
          ${documentId}::uuid,
          ${personId}::uuid,
          ${caseId}::uuid,
          ${sourceUpload.id}::uuid,
          'resume',
          ${`intake-upload:${sourceUpload.id}`},
          'pending',
          ${documentProvenance}::jsonb,
          ${now},
          ${now}
        )
      `.execute(transaction);

      await appendAuditEvent(transaction, {
        eventType: "intake.candidate_document.linked",
        actorType: "system_worker",
        subjectType: "candidate_document",
        subjectId: documentId,
        requestId: event.id,
        afterState: { documentKind: "resume", reviewState: "pending" },
        metadata: { submissionId: submission.id, caseId },
        policyVersion: input.consent.privacyPolicyVersion,
        occurredAt: now,
      });
      await transaction
        .insertInto("platform.outbox_event")
        .values({
          id: newUuid(),
          topic: "candidate360.document.created.v1",
          aggregate_type: "candidate_document",
          aggregate_id: documentId,
          payload: { documentId, personId, caseId, documentKind: "resume" },
          idempotency_key: `candidate360.document.created:${documentId}`,
          occurred_at: now,
          available_at: now,
          attempt_count: 0,
          locked_at: null,
          locked_by: null,
          delivered_at: null,
          last_error_code: null,
        })
        .execute();

      if (input.application.applicantType === "relocation") {
        await transaction
          .insertInto("crm.relocation_profile")
          .values({
            id: newUuid(),
            case_id: caseId,
            employer_id: null,
            position: input.application.wishPost,
            municipality: input.application.region,
            locality: null,
            planned_date: null,
            actual_date: null,
            household: {},
            tickets: {},
            updated_at: now,
            archived_at: null,
          })
          .execute();
      }

      await transaction
        .updateTable("intake.submission")
        .set({ status: "routed", routed_case_id: caseId, updated_at: now })
        .where("id", "=", submission.id)
        .executeTakeFirstOrThrow();
      await appendAuditEvent(transaction, {
        eventType: "intake.application.routed",
        actorType: "system_worker",
        subjectType: "crm_case",
        subjectId: caseId,
        requestId: event.id,
        afterState: { status: "open", stageCode: "new" },
        metadata: {
          applicantType: input.application.applicantType,
          candidateDocumentCreated: true,
          reusedPerson: identityMatch.kind === "reuse",
          submissionId: submission.id,
        },
        policyVersion: input.consent.privacyPolicyVersion,
        occurredAt: now,
      });
      await transaction
        .insertInto("platform.outbox_event")
        .values({
          id: newUuid(),
          topic: "crm.case.created.v1",
          aggregate_type: "crm_case",
          aggregate_id: caseId,
          payload: { caseId, casePublicId, sourceSubmissionId: submission.id },
          idempotency_key: `crm.case.created:${caseId}`,
          occurred_at: now,
          available_at: now,
          attempt_count: 0,
          locked_at: null,
          locked_by: null,
          delivered_at: null,
          last_error_code: null,
        })
        .execute();
      await this.finishEvent(transaction, event.id, { outcome: "routed", caseId });
      return "routed";
    });
  }

  private async markNeedsReview(
    transaction: Transaction<Database>,
    eventId: string,
    submissionId: string,
    reasonCode: string,
  ): Promise<void> {
    const now = new Date();
    await transaction
      .updateTable("intake.submission")
      .set({ status: "needs_review", updated_at: now })
      .where("id", "=", submissionId)
      .executeTakeFirstOrThrow();
    await appendAuditEvent(transaction, {
      eventType: "intake.application.needs_review",
      actorType: "system_worker",
      subjectType: "intake_submission",
      subjectId: submissionId,
      requestId: eventId,
      reason: reasonCode,
      afterState: { status: "needs_review" },
      metadata: { reasonCode },
      occurredAt: now,
    });
    await transaction
      .insertInto("platform.outbox_event")
      .values({
        id: newUuid(),
        topic: "intake.application.needs_review.v1",
        aggregate_type: "intake_submission",
        aggregate_id: submissionId,
        payload: { submissionId, reasonCode },
        idempotency_key: `intake.application.needs_review:${submissionId}`,
        occurred_at: now,
        available_at: now,
        attempt_count: 0,
        locked_at: null,
        locked_by: null,
        delivered_at: null,
        last_error_code: null,
      })
      .onConflict((conflict) => conflict.column("idempotency_key").doNothing())
      .execute();
    await this.finishEvent(transaction, eventId, { outcome: "needs_review", reasonCode });
  }

  private async finishEvent(
    transaction: Transaction<Database>,
    eventId: string,
    result: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    await transaction
      .insertInto("platform.inbox_event")
      .values({ consumer: CONSUMER, event_id: eventId, result })
      .onConflict((conflict) => conflict.columns(["consumer", "event_id"]).doNothing())
      .execute();
    await this.markDelivered(transaction, eventId);
  }

  private async markDelivered(transaction: Transaction<Database>, eventId: string): Promise<void> {
    await transaction
      .updateTable("platform.outbox_event")
      .set({ delivered_at: new Date(), locked_at: null, locked_by: null, last_error_code: null })
      .where("id", "=", eventId)
      .where("locked_by", "=", this.options.workerId)
      .execute();
  }

  private async releaseAfterFailure(event: ClaimedEvent, errorCode: string): Promise<void> {
    const backoffSeconds = Math.min(3_600, 2 ** Math.min(event.attempt_count, 12));
    await this.db
      .updateTable("platform.outbox_event")
      .set({
        available_at: new Date(Date.now() + backoffSeconds * 1_000),
        locked_at: null,
        locked_by: null,
        last_error_code: errorCode,
      })
      .where("id", "=", event.id)
      .where("locked_by", "=", this.options.workerId)
      .execute();
  }
}
