import type { Kysely, Transaction, Updateable } from "kysely";
import { sql } from "kysely";
import { AppError } from "../../../common/errors.js";
import { newPublicId, newUuid } from "../../../common/id.js";
import type { CrmCaseTable, CrmTaskTable, Database, RelocationProfileTable } from "../../../db/types.js";
import {
  caseScopeSql,
  crmEntityIdentifierSql,
  employerScopeSql,
  referralScopeSql,
  taskScopeSql,
} from "../../crm/adapters/postgres-crm-repository.js";
import type { CrmEmployerDetail, CrmReferralDetail, CrmTaskDetail } from "../../crm/contracts.js";
import type { CrmRepositoryPort } from "../../crm/ports.js";
import { appendAuditEvent } from "../../platform/audit.js";
import type {
  CreateEmployerBody,
  CreateReferralBody,
  CreateTaskBody,
  TransitionReferralBody,
  UpdateCaseBody,
  UpdateTaskBody,
} from "../contracts.js";
import type {
  CrmCommandRepositoryPort,
  CrmCreateCommand,
  CrmUpdateCommand,
  IdempotentCrmResult,
} from "../ports.js";

type CrmTransaction = Transaction<Database>;

interface IdempotencyClaim {
  readonly replayedResourceId: string | null;
}

const TERMINAL_REFERRAL_STAGES = new Set([
  "accepted",
  "rejected_by_employer",
  "rejected_by_candidate",
  "cancelled",
]);

function unique(values: readonly string[] | undefined): string[] {
  return [...new Set(values ?? [])];
}

function toVersion(value: number | string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw new Error("Invalid aggregate version");
  return result;
}

export class PostgresCrmCommandRepository implements CrmCommandRepositoryPort {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly reads: CrmRepositoryPort,
    private readonly idempotencyTtlSeconds: number,
  ) {}

  async updateCase(command: CrmUpdateCommand<UpdateCaseBody>) {
    const result = await this.db.transaction().execute(async (transaction) => {
      const current = await transaction
        .selectFrom("crm.case as case_row")
        .selectAll("case_row")
        .where("case_row.archived_at", "is", null)
        .where(crmEntityIdentifierSql("case_row", command.resourceId))
        .where(caseScopeSql(command.access, "case_row"))
        .forUpdate()
        .executeTakeFirst();
      if (!current) return { kind: "not_found" as const };
      const currentVersion = toVersion(current.version);
      if (currentVersion !== command.expectedVersion) {
        return { kind: "version_conflict" as const, currentVersion };
      }

      if (command.input.ownerEmployeeProfileId) {
        await this.assertAssignableEmployee(
          transaction,
          command.input.ownerEmployeeProfileId,
          command.access,
        );
      }
      if (command.input.relocation?.employerId) {
        const employer = await transaction
          .selectFrom("crm.employer as employer")
          .select("employer.id")
          .where("employer.id", "=", command.input.relocation.employerId)
          .where("employer.archived_at", "is", null)
          .where(employerScopeSql(command.access, "employer"))
          .executeTakeFirst();
        if (!employer) {
          return {
            kind: "guard_failed" as const,
            errors: [
              {
                field: "relocation.employerId",
                code: "not_visible",
                message: "Работодатель недоступен в области пользователя",
              },
            ],
          };
        }
      }

      const now = new Date();
      const update: Updateable<CrmCaseTable> = {
        attributes: sql`attributes`,
        ...(command.input.title !== undefined ? { title: command.input.title.trim() } : {}),
        ...(command.input.nextStep !== undefined ? { next_step: command.input.nextStep } : {}),
      };
      const updated = await transaction
        .updateTable("crm.case")
        .set(update)
        .where("id", "=", current.id)
        .where("version", "=", command.expectedVersion)
        .returning(["id", "version", "title", "next_step"])
        .executeTakeFirst();
      if (!updated) return { kind: "version_conflict" as const, currentVersion };

      if (command.input.ownerEmployeeProfileId !== undefined) {
        await transaction
          .updateTable("crm.case_assignment")
          .set({ valid_to: now })
          .where("case_id", "=", current.id)
          .where("role", "=", "owner")
          .where("valid_to", "is", null)
          .where("archived_at", "is", null)
          .execute();
        if (command.input.ownerEmployeeProfileId !== null) {
          await transaction
            .insertInto("crm.case_assignment")
            .values({
              id: newUuid(),
              case_id: current.id,
              employee_profile_id: command.input.ownerEmployeeProfileId,
              legacy_actor_id: null,
              role: "owner",
              valid_from: now,
              valid_to: null,
              provenance: { sourceSystem: "crm", operation: "UpdateCase" },
              created_at: now,
              updated_at: now,
              archived_at: null,
            })
            .execute();
        }
      }

      if (command.input.relocation !== undefined) {
        await this.upsertRelocation(transaction, current.id, command.input.relocation, now);
      }

      const version = toVersion(updated.version);
      const beforeState = {
        title: current.title,
        nextStep: current.next_step,
        version: currentVersion,
      };
      const afterState = { title: updated.title, nextStep: updated.next_step, version };
      await appendAuditEvent(transaction, {
        eventType: "crm.case.updated",
        actorType: "user_account",
        actorId: command.actor.userAccountId,
        subjectType: "crm_case",
        subjectId: current.id,
        requestId: command.actor.requestId,
        reason: command.input.reason,
        beforeState,
        afterState,
        metadata: {
          ownerChanged: command.input.ownerEmployeeProfileId !== undefined,
          relocationChanged: command.input.relocation !== undefined,
        },
        policyVersion: "crm-commands@1",
        scopeSnapshot: { visibility: command.access.visibility },
        occurredAt: now,
      });
      await this.enqueue(transaction, "crm.case.updated.v1", "crm_case", current.id, version, {
        caseId: current.id,
        version,
      });
      return { kind: "updated" as const, id: current.id, version };
    });

    if (result.kind !== "updated") return result;
    const value = await this.reads.getCase(command.access, result.id);
    if (!value) throw new Error("Updated CRM case is not readable after commit");
    return { kind: "updated" as const, value };
  }

  async createEmployer(
    command: CrmCreateCommand<CreateEmployerBody>,
  ): Promise<IdempotentCrmResult<CrmEmployerDetail>> {
    const created = await this.db.transaction().execute(async (transaction) => {
      const idempotencyScope = `crm.employer.create:${command.actor.userAccountId}`;
      const claim = await this.claimIdempotency(
        transaction,
        idempotencyScope,
        command.idempotencyKey,
        command.requestHash,
      );
      if (claim.replayedResourceId) {
        return { id: claim.replayedResourceId, replayed: true };
      }

      const ownerId = command.input.ownerEmployeeProfileId ?? command.actor.employeeProfileId;
      if (command.access.visibility !== "all" && !ownerId) {
        throw new AppError(403, "employee_profile_required", "Для создания нужен профиль сотрудника");
      }
      if (ownerId) await this.assertAssignableEmployee(transaction, ownerId, command.access);

      if (command.input.taxId) {
        const duplicate = await transaction
          .selectFrom("crm.employer")
          .select("public_id")
          .where("normalized_tax_id", "=", command.input.taxId)
          .where("archived_at", "is", null)
          .executeTakeFirst();
        if (duplicate) {
          throw new AppError(409, "employer_tax_id_conflict", "Работодатель с таким ИНН уже существует", {
            details: { employerId: duplicate.public_id },
          });
        }
      }

      const now = new Date();
      const id = newUuid();
      await transaction
        .insertInto("crm.employer")
        .values({
          id,
          public_id: newPublicId("employer"),
          name: command.input.name.trim(),
          legal_name: command.input.legalName?.trim() ?? null,
          normalized_tax_id: command.input.taxId ?? null,
          status: command.input.taxId ? "active" : "needs_review",
          organization_type: command.input.organizationType,
          manual_review_reason: command.input.manualReviewReason?.trim() ?? null,
          provenance: { sourceSystem: "crm", operation: "CreateEmployer" },
          created_at: now,
          updated_at: now,
          archived_at: null,
        })
        .execute();
      for (const contact of command.input.contacts ?? []) {
        await transaction
          .insertInto("crm.employer_contact")
          .values({
            id: newUuid(),
            employer_id: id,
            person_id: null,
            name: contact.name.trim(),
            position: contact.position?.trim() ?? null,
            email: contact.email?.trim().toLocaleLowerCase("en-US") ?? null,
            phone: contact.phone ?? null,
            is_primary: contact.isPrimary ?? false,
            created_at: now,
            updated_at: now,
            archived_at: null,
          })
          .execute();
      }
      if (ownerId) {
        await transaction
          .insertInto("crm.employer_assignment")
          .values({
            id: newUuid(),
            employer_id: id,
            employee_profile_id: ownerId,
            role: "owner",
            valid_from: now,
            valid_to: null,
            provenance: { sourceSystem: "crm", operation: "CreateEmployer" },
            created_at: now,
            updated_at: now,
            archived_at: null,
          })
          .execute();
      }
      await appendAuditEvent(transaction, {
        eventType: "crm.employer.created",
        actorType: "user_account",
        actorId: command.actor.userAccountId,
        subjectType: "employer",
        subjectId: id,
        requestId: command.actor.requestId,
        afterState: {
          status: command.input.taxId ? "active" : "needs_review",
          organizationType: command.input.organizationType,
          hasTaxId: Boolean(command.input.taxId),
          contactCount: command.input.contacts?.length ?? 0,
        },
        policyVersion: "crm-commands@1",
        scopeSnapshot: { visibility: command.access.visibility },
        occurredAt: now,
      });
      await this.enqueue(transaction, "crm.employer.created.v1", "employer", id, 1, { employerId: id });
      await this.completeIdempotency(transaction, idempotencyScope, command.idempotencyKey, id);
      return { id, replayed: false };
    });

    const value = await this.reads.getEmployer(command.access, created.id);
    if (!value) throw new Error("Created employer is not readable after commit");
    return { value, replayed: created.replayed };
  }

  async createReferral(
    command: CrmCreateCommand<CreateReferralBody>,
  ): Promise<IdempotentCrmResult<CrmReferralDetail>> {
    const created = await this.db.transaction().execute(async (transaction) => {
      const idempotencyScope = `crm.referral.create:${command.actor.userAccountId}`;
      const claim = await this.claimIdempotency(
        transaction,
        idempotencyScope,
        command.idempotencyKey,
        command.requestHash,
      );
      if (claim.replayedResourceId) return { id: claim.replayedResourceId, replayed: true };

      const caseRow = await transaction
        .selectFrom("crm.case as case_row")
        .leftJoin("crm.case_person as primary_person", (join) =>
          join.onRef("primary_person.case_id", "=", "case_row.id").on("primary_person.is_primary", "=", true),
        )
        .select(["case_row.id", "primary_person.person_id"])
        .where("case_row.archived_at", "is", null)
        .where(crmEntityIdentifierSql("case_row", command.input.caseId))
        .where(caseScopeSql(command.access, "case_row"))
        .executeTakeFirst();
      if (!caseRow) throw new AppError(404, "case_not_found", "CRM-кейс не найден");
      const employer = await transaction
        .selectFrom("crm.employer as employer")
        .select("employer.id")
        .where("employer.archived_at", "is", null)
        .where(crmEntityIdentifierSql("employer", command.input.employerId))
        .where(employerScopeSql(command.access, "employer"))
        .executeTakeFirst();
      if (!employer) throw new AppError(404, "employer_not_found", "Работодатель не найден");

      const ownerId = command.input.ownerEmployeeProfileId ?? command.actor.employeeProfileId;
      if (!ownerId)
        throw new AppError(403, "employee_profile_required", "Для направления нужен ответственный");
      await this.assertAssignableEmployee(transaction, ownerId, command.access);

      const now = new Date();
      const id = newUuid();
      await transaction
        .insertInto("crm.employer_referral")
        .values({
          id,
          public_id: newPublicId("referral"),
          case_id: caseRow.id,
          person_id: caseRow.person_id,
          employer_id: employer.id,
          owner_employee_profile_id: ownerId,
          stage_code: "on_review",
          channel_code: command.input.channelCode ?? null,
          vacancy_title: command.input.vacancyTitle?.trim() ?? null,
          sent_at: now,
          result_at: null,
          comment: command.input.comment?.trim() ?? null,
          provenance: { sourceSystem: "crm", operation: "CreateEmployerReferral" },
          created_at: now,
          updated_at: now,
          archived_at: null,
        })
        .execute();
      await transaction
        .insertInto("crm.employer_referral_stage_history")
        .values({
          id: newUuid(),
          employer_referral_id: id,
          from_stage_code: null,
          to_stage_code: "on_review",
          reason_code: null,
          reason_text: null,
          actor_user_account_id: command.actor.userAccountId,
          aggregate_version: 1,
          occurred_at: now,
          created_at: now,
        })
        .execute();
      await appendAuditEvent(transaction, {
        eventType: "crm.employer_referral.created",
        actorType: "user_account",
        actorId: command.actor.userAccountId,
        subjectType: "employer_referral",
        subjectId: id,
        requestId: command.actor.requestId,
        afterState: { stageCode: "on_review", caseId: caseRow.id, employerId: employer.id },
        policyVersion: "crm-commands@1",
        scopeSnapshot: { visibility: command.access.visibility },
        occurredAt: now,
      });
      await this.enqueue(transaction, "crm.employer_referral.created.v1", "employer_referral", id, 1, {
        referralId: id,
      });
      await this.completeIdempotency(transaction, idempotencyScope, command.idempotencyKey, id);
      return { id, replayed: false };
    });

    const value = await this.reads.getReferral(command.access, created.id);
    if (!value) throw new Error("Created referral is not readable after commit");
    return { value, replayed: created.replayed };
  }

  async transitionReferral(command: CrmUpdateCommand<TransitionReferralBody>) {
    const result = await this.db.transaction().execute(async (transaction) => {
      const current = await transaction
        .selectFrom("crm.employer_referral as referral")
        .selectAll("referral")
        .where("referral.archived_at", "is", null)
        .where(crmEntityIdentifierSql("referral", command.resourceId))
        .where(referralScopeSql(command.access, "referral"))
        .forUpdate()
        .executeTakeFirst();
      if (!current) return { kind: "not_found" as const };
      const currentVersion = toVersion(current.version);
      if (currentVersion !== command.expectedVersion) {
        return { kind: "version_conflict" as const, currentVersion };
      }

      const reopening =
        TERMINAL_REFERRAL_STAGES.has(current.stage_code) && command.input.toStageCode === "on_review";
      const closing =
        current.stage_code === "on_review" && TERMINAL_REFERRAL_STAGES.has(command.input.toStageCode);
      if ((!reopening && !closing) || current.stage_code === command.input.toStageCode) {
        return {
          kind: "guard_failed" as const,
          errors: [
            { field: "toStageCode", code: "transition_not_allowed", message: "Переход направления запрещён" },
          ],
        };
      }
      if (reopening && !command.input.reasonCode?.trim() && !command.input.reasonText?.trim()) {
        return {
          kind: "guard_failed" as const,
          errors: [{ field: "reasonText", code: "required", message: "Для возврата требуется причина" }],
        };
      }

      const now = new Date();
      const updated = await transaction
        .updateTable("crm.employer_referral")
        .set({
          stage_code: command.input.toStageCode,
          result_at: TERMINAL_REFERRAL_STAGES.has(command.input.toStageCode) ? now : null,
        })
        .where("id", "=", current.id)
        .where("version", "=", command.expectedVersion)
        .where("stage_code", "=", current.stage_code)
        .returning(["version", "stage_code", "result_at"])
        .executeTakeFirst();
      if (!updated) {
        return { kind: "state_conflict" as const, currentState: current.stage_code, currentVersion };
      }
      const version = toVersion(updated.version);
      await transaction
        .insertInto("crm.employer_referral_stage_history")
        .values({
          id: newUuid(),
          employer_referral_id: current.id,
          from_stage_code: current.stage_code,
          to_stage_code: updated.stage_code,
          reason_code: command.input.reasonCode ?? null,
          reason_text: command.input.reasonText ?? null,
          actor_user_account_id: command.actor.userAccountId,
          aggregate_version: version,
          occurred_at: now,
          created_at: now,
        })
        .execute();
      await appendAuditEvent(transaction, {
        eventType: "crm.employer_referral.transitioned",
        actorType: "user_account",
        actorId: command.actor.userAccountId,
        subjectType: "employer_referral",
        subjectId: current.id,
        requestId: command.actor.requestId,
        reason: command.input.reasonText ?? command.input.reasonCode ?? null,
        beforeState: { stageCode: current.stage_code, version: currentVersion },
        afterState: { stageCode: updated.stage_code, version },
        policyVersion: "crm-commands@1",
        scopeSnapshot: { visibility: command.access.visibility },
        occurredAt: now,
      });
      await this.enqueue(
        transaction,
        "crm.employer_referral.transitioned.v1",
        "employer_referral",
        current.id,
        version,
        { referralId: current.id, from: current.stage_code, to: updated.stage_code, version },
      );
      return { kind: "updated" as const, id: current.id };
    });

    if (result.kind !== "updated") return result;
    const value = await this.reads.getReferral(command.access, result.id);
    if (!value) throw new Error("Updated referral is not readable after commit");
    return { kind: "updated" as const, value };
  }

  async createTask(command: CrmCreateCommand<CreateTaskBody>): Promise<IdempotentCrmResult<CrmTaskDetail>> {
    const created = await this.db.transaction().execute(async (transaction) => {
      const idempotencyScope = `crm.task.create:${command.actor.userAccountId}`;
      const claim = await this.claimIdempotency(
        transaction,
        idempotencyScope,
        command.idempotencyKey,
        command.requestHash,
      );
      if (claim.replayedResourceId) return { id: claim.replayedResourceId, replayed: true };

      const link = await this.resolveTaskLink(
        transaction,
        command.input.caseId,
        command.input.employerReferralId,
        command.access,
      );
      await this.assertAssignableEmployee(
        transaction,
        command.input.responsibleEmployeeProfileId,
        command.access,
      );
      const participants = unique(command.input.participantEmployeeProfileIds);
      for (const participant of participants) {
        await this.assertAssignableEmployee(transaction, participant, command.access);
      }

      const now = new Date();
      const id = newUuid();
      await transaction
        .insertInto("crm.task")
        .values({
          id,
          public_id: newPublicId("task"),
          case_id: link.caseId,
          employer_referral_id: link.referralId,
          title: command.input.title.trim(),
          description: command.input.description?.trim() ?? null,
          state: "to_do",
          responsible_employee_profile_id: command.input.responsibleEmployeeProfileId,
          due_at: command.input.dueAt ? new Date(command.input.dueAt) : null,
          completed_at: null,
          priority: command.input.priority ?? "normal",
          timezone: command.input.timezone ?? "Europe/Moscow",
          creator_user_account_id: command.actor.userAccountId,
          provenance: { sourceSystem: "crm", operation: "CreateCrmTask" },
          created_at: now,
          updated_at: now,
          archived_at: null,
        })
        .execute();
      await this.insertTaskChildren(transaction, id, participants, command.input.checklist ?? [], now);
      await transaction
        .insertInto("crm.task_history")
        .values({
          id: newUuid(),
          task_id: id,
          change_type: "created",
          before_state: null,
          after_state: {
            state: "to_do",
            responsibleEmployeeProfileId: command.input.responsibleEmployeeProfileId,
          },
          actor_user_account_id: command.actor.userAccountId,
          aggregate_version: 1,
          occurred_at: now,
          created_at: now,
        })
        .execute();
      await appendAuditEvent(transaction, {
        eventType: "crm.task.created",
        actorType: "user_account",
        actorId: command.actor.userAccountId,
        subjectType: "crm_task",
        subjectId: id,
        requestId: command.actor.requestId,
        afterState: { state: "to_do", priority: command.input.priority ?? "normal" },
        policyVersion: "crm-commands@1",
        scopeSnapshot: { visibility: command.access.visibility },
        occurredAt: now,
      });
      await this.enqueue(transaction, "crm.task.created.v1", "crm_task", id, 1, { taskId: id });
      await this.completeIdempotency(transaction, idempotencyScope, command.idempotencyKey, id);
      return { id, replayed: false };
    });

    const value = await this.reads.getTask(command.access, created.id);
    if (!value) throw new Error("Created CRM task is not readable after commit");
    return { value, replayed: created.replayed };
  }

  async updateTask(command: CrmUpdateCommand<UpdateTaskBody>) {
    const result = await this.db.transaction().execute(async (transaction) => {
      const current = await transaction
        .selectFrom("crm.task as task_row")
        .selectAll("task_row")
        .where("task_row.archived_at", "is", null)
        .where(crmEntityIdentifierSql("task_row", command.resourceId))
        .where(taskScopeSql(command.access, "task_row"))
        .forUpdate()
        .executeTakeFirst();
      if (!current) return { kind: "not_found" as const };
      const currentVersion = toVersion(current.version);
      if (currentVersion !== command.expectedVersion) {
        return { kind: "version_conflict" as const, currentVersion };
      }
      if (command.input.responsibleEmployeeProfileId) {
        await this.assertAssignableEmployee(
          transaction,
          command.input.responsibleEmployeeProfileId,
          command.access,
        );
      }
      const participants = unique(command.input.participantEmployeeProfileIds);
      for (const participant of participants) {
        await this.assertAssignableEmployee(transaction, participant, command.access);
      }

      const update: Updateable<CrmTaskTable> = {
        provenance: sql`provenance`,
        ...(command.input.title !== undefined ? { title: command.input.title.trim() } : {}),
        ...(command.input.description !== undefined ? { description: command.input.description } : {}),
        ...(command.input.responsibleEmployeeProfileId !== undefined
          ? { responsible_employee_profile_id: command.input.responsibleEmployeeProfileId }
          : {}),
        ...(command.input.dueAt !== undefined
          ? { due_at: command.input.dueAt ? new Date(command.input.dueAt) : null }
          : {}),
        ...(command.input.timezone !== undefined ? { timezone: command.input.timezone } : {}),
        ...(command.input.priority !== undefined ? { priority: command.input.priority } : {}),
      };
      const now = new Date();
      const updated = await transaction
        .updateTable("crm.task")
        .set(update)
        .where("id", "=", current.id)
        .where("version", "=", command.expectedVersion)
        .returning([
          "version",
          "title",
          "description",
          "responsible_employee_profile_id",
          "due_at",
          "priority",
          "timezone",
        ])
        .executeTakeFirst();
      if (!updated) return { kind: "version_conflict" as const, currentVersion };

      if (command.input.participantEmployeeProfileIds !== undefined) {
        await transaction
          .updateTable("crm.task_participant")
          .set({ valid_to: now })
          .where("task_id", "=", current.id)
          .where("valid_to", "is", null)
          .execute();
        for (const participant of participants) {
          await transaction
            .insertInto("crm.task_participant")
            .values({
              id: newUuid(),
              task_id: current.id,
              employee_profile_id: participant,
              role: "participant",
              valid_from: now,
              valid_to: null,
              created_at: now,
            })
            .execute();
        }
      }
      if (command.input.checklist !== undefined) {
        await transaction
          .updateTable("crm.task_checklist_item")
          .set({ archived_at: now })
          .where("task_id", "=", current.id)
          .where("archived_at", "is", null)
          .execute();
        for (const [position, item] of command.input.checklist.entries()) {
          await transaction
            .insertInto("crm.task_checklist_item")
            .values({
              id: newUuid(),
              task_id: current.id,
              title: item.title.trim(),
              completed: item.completed ?? false,
              position,
              created_at: now,
              updated_at: now,
              archived_at: null,
            })
            .execute();
        }
      }

      const version = toVersion(updated.version);
      const beforeState = {
        title: current.title,
        description: current.description,
        responsibleEmployeeProfileId: current.responsible_employee_profile_id,
        dueAt: current.due_at,
        priority: current.priority,
        timezone: current.timezone,
        version: currentVersion,
      };
      const afterState = {
        title: updated.title,
        description: updated.description,
        responsibleEmployeeProfileId: updated.responsible_employee_profile_id,
        dueAt: updated.due_at,
        priority: updated.priority,
        timezone: updated.timezone,
        version,
      };
      await transaction
        .insertInto("crm.task_history")
        .values({
          id: newUuid(),
          task_id: current.id,
          change_type: "updated",
          before_state: beforeState,
          after_state: afterState,
          actor_user_account_id: command.actor.userAccountId,
          aggregate_version: version,
          occurred_at: now,
          created_at: now,
        })
        .execute();
      await appendAuditEvent(transaction, {
        eventType: "crm.task.updated",
        actorType: "user_account",
        actorId: command.actor.userAccountId,
        subjectType: "crm_task",
        subjectId: current.id,
        requestId: command.actor.requestId,
        reason: command.input.reason,
        beforeState,
        afterState,
        policyVersion: "crm-commands@1",
        scopeSnapshot: { visibility: command.access.visibility },
        occurredAt: now,
      });
      await this.enqueue(transaction, "crm.task.updated.v1", "crm_task", current.id, version, {
        taskId: current.id,
        version,
      });
      return { kind: "updated" as const, id: current.id };
    });

    if (result.kind !== "updated") return result;
    const value = await this.reads.getTask(command.access, result.id);
    if (!value) throw new Error("Updated CRM task is not readable after commit");
    return { kind: "updated" as const, value };
  }

  private async claimIdempotency(
    transaction: CrmTransaction,
    scope: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<IdempotencyClaim> {
    const now = new Date();
    const inserted = await transaction
      .insertInto("platform.idempotency_record")
      .values({
        scope,
        idempotency_key: idempotencyKey,
        request_hash: requestHash,
        response_status: null,
        response_body: null,
        resource_id: null,
        state: "processing",
        locked_until: new Date(now.getTime() + 30_000),
        expires_at: new Date(now.getTime() + this.idempotencyTtlSeconds * 1_000),
        created_at: now,
        updated_at: now,
      })
      .onConflict((conflict) => conflict.columns(["scope", "idempotency_key"]).doNothing())
      .returning("idempotency_key")
      .executeTakeFirst();
    if (inserted) return { replayedResourceId: null };

    const existing = await transaction
      .selectFrom("platform.idempotency_record")
      .select(["request_hash", "state", "resource_id", "expires_at"])
      .where("scope", "=", scope)
      .where("idempotency_key", "=", idempotencyKey)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (existing.request_hash !== requestHash) {
      throw new AppError(409, "idempotency_conflict", "Idempotency-Key уже использован с другим запросом");
    }
    if (new Date(existing.expires_at) <= now) {
      throw new AppError(409, "idempotency_expired", "Idempotency-Key истёк; используйте новый ключ");
    }
    if (existing.state !== "completed" || !existing.resource_id) {
      throw new AppError(409, "idempotency_in_progress", "Операция с этим ключом ещё выполняется");
    }
    return { replayedResourceId: existing.resource_id };
  }

  private async completeIdempotency(
    transaction: CrmTransaction,
    scope: string,
    idempotencyKey: string,
    resourceId: string,
  ): Promise<void> {
    const result = await transaction
      .updateTable("platform.idempotency_record")
      .set({
        state: "completed",
        response_status: 201,
        response_body: { resourceId },
        resource_id: resourceId,
        locked_until: null,
      })
      .where("scope", "=", scope)
      .where("idempotency_key", "=", idempotencyKey)
      .where("state", "=", "processing")
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) !== 1) throw new Error("Could not complete idempotency record");
  }

  private async assertAssignableEmployee(
    transaction: CrmTransaction,
    employeeProfileId: string,
    access: CrmUpdateCommand<unknown>["access"],
  ): Promise<void> {
    const employee = await transaction
      .selectFrom("identity.employee_profile")
      .select(["id", "organization_unit_id"])
      .where("id", "=", employeeProfileId)
      .where("employment_state", "=", "active")
      .where("archived_at", "is", null)
      .executeTakeFirst();
    if (!employee) throw new AppError(422, "employee_unavailable", "Профиль сотрудника недоступен");
    if (access.visibility === "all") return;
    const explicitlyVisible = access.employeeProfileIds.includes(employee.id);
    const departmentVisible =
      employee.organization_unit_id !== null &&
      access.organizationUnitIds.includes(employee.organization_unit_id);
    if (!explicitlyVisible && !departmentVisible) {
      throw new AppError(403, "employee_out_of_scope", "Сотрудник вне области доступа");
    }
  }

  private async upsertRelocation(
    transaction: CrmTransaction,
    caseId: string,
    input: NonNullable<UpdateCaseBody["relocation"]>,
    now: Date,
  ): Promise<void> {
    const current = await transaction
      .selectFrom("crm.relocation_profile")
      .selectAll()
      .where("case_id", "=", caseId)
      .where("archived_at", "is", null)
      .forUpdate()
      .executeTakeFirst();
    const update: Updateable<RelocationProfileTable> = {
      ...(input.employerId !== undefined ? { employer_id: input.employerId } : {}),
      ...(input.position !== undefined ? { position: input.position } : {}),
      ...(input.municipality !== undefined ? { municipality: input.municipality } : {}),
      ...(input.locality !== undefined ? { locality: input.locality } : {}),
      ...(input.plannedDate !== undefined ? { planned_date: input.plannedDate } : {}),
      ...(input.actualDate !== undefined ? { actual_date: input.actualDate } : {}),
      ...(input.offerStatus !== undefined ? { offer_status: input.offerStatus } : {}),
      ...(input.employmentStatus !== undefined ? { employment_status: input.employmentStatus } : {}),
      ...(input.household !== undefined ? { household: input.household } : {}),
      ...(input.supportMeasures !== undefined ? { support_measures: input.supportMeasures } : {}),
      ...(input.resultCode !== undefined ? { result_code: input.resultCode } : {}),
      ...(input.resultReason !== undefined ? { result_reason: input.resultReason } : {}),
    };
    if (current) {
      await transaction
        .updateTable("crm.relocation_profile")
        .set(update)
        .where("id", "=", current.id)
        .execute();
      return;
    }
    await transaction
      .insertInto("crm.relocation_profile")
      .values({
        id: newUuid(),
        case_id: caseId,
        employer_id: input.employerId ?? null,
        position: input.position ?? null,
        municipality: input.municipality ?? null,
        locality: input.locality ?? null,
        planned_date: input.plannedDate ?? null,
        actual_date: input.actualDate ?? null,
        offer_status: input.offerStatus ?? null,
        employment_status: input.employmentStatus ?? null,
        support_measures: input.supportMeasures ?? [],
        result_code: input.resultCode ?? null,
        result_reason: input.resultReason ?? null,
        household: input.household ?? {},
        tickets: {},
        created_at: now,
        updated_at: now,
        archived_at: null,
      })
      .execute();
  }

  private async resolveTaskLink(
    transaction: CrmTransaction,
    caseIdentifier: string | undefined,
    referralIdentifier: string | undefined,
    access: CrmUpdateCommand<unknown>["access"],
  ): Promise<{ caseId: string | null; referralId: string | null }> {
    if (caseIdentifier) {
      const row = await transaction
        .selectFrom("crm.case as case_row")
        .select("case_row.id")
        .where("case_row.archived_at", "is", null)
        .where(crmEntityIdentifierSql("case_row", caseIdentifier))
        .where(caseScopeSql(access, "case_row"))
        .executeTakeFirst();
      if (!row) throw new AppError(404, "case_not_found", "CRM-кейс не найден");
      return { caseId: row.id, referralId: null };
    }
    if (referralIdentifier) {
      const row = await transaction
        .selectFrom("crm.employer_referral as referral")
        .select("referral.id")
        .where("referral.archived_at", "is", null)
        .where(crmEntityIdentifierSql("referral", referralIdentifier))
        .where(referralScopeSql(access, "referral"))
        .executeTakeFirst();
      if (!row) throw new AppError(404, "referral_not_found", "Направление не найдено");
      return { caseId: null, referralId: row.id };
    }
    throw new AppError(422, "linked_crm_object_required", "Задача должна быть связана с CRM-объектом");
  }

  private async insertTaskChildren(
    transaction: CrmTransaction,
    taskId: string,
    participants: readonly string[],
    checklist: readonly { readonly title: string; readonly completed?: boolean }[],
    now: Date,
  ): Promise<void> {
    for (const participant of participants) {
      await transaction
        .insertInto("crm.task_participant")
        .values({
          id: newUuid(),
          task_id: taskId,
          employee_profile_id: participant,
          role: "participant",
          valid_from: now,
          valid_to: null,
          created_at: now,
        })
        .execute();
    }
    for (const [position, item] of checklist.entries()) {
      await transaction
        .insertInto("crm.task_checklist_item")
        .values({
          id: newUuid(),
          task_id: taskId,
          title: item.title.trim(),
          completed: item.completed ?? false,
          position,
          created_at: now,
          updated_at: now,
          archived_at: null,
        })
        .execute();
    }
  }

  private async enqueue(
    transaction: CrmTransaction,
    topic: string,
    aggregateType: string,
    aggregateId: string,
    version: number,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const now = new Date();
    await transaction
      .insertInto("platform.outbox_event")
      .values({
        id: newUuid(),
        topic,
        aggregate_type: aggregateType,
        aggregate_id: aggregateId,
        payload,
        idempotency_key: `${topic}:${aggregateId}:v${version}`,
        occurred_at: now,
        available_at: now,
        attempt_count: 0,
        locked_at: null,
        locked_by: null,
        delivered_at: null,
        last_error_code: null,
      })
      .execute();
  }
}
