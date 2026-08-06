import { createHmac } from "node:crypto";
import { AppError } from "../../common/errors.js";
import type { CrmOperationDefinition } from "../../registry/operation-registry.js";
import type { CrmCaseDetail, CrmEmployerDetail, CrmReferralDetail, CrmTaskDetail } from "../crm/contracts.js";
import type {
  CrmActorContext,
  CrmAuthorizationPort,
  CrmMutationResult,
  CrmResourceReference,
} from "../crm/ports.js";
import type {
  CreateEmployerBody,
  CreateReferralBody,
  CreateTaskBody,
  TransitionReferralBody,
  UpdateCaseBody,
  UpdateTaskBody,
} from "./contracts.js";
import type { CrmCommandRepositoryPort, IdempotentCrmResult } from "./ports.js";
import {
  CRM_COMMAND_OPERATIONS,
  type CrmCommandOperationDefinition,
  type CrmCommandOperationKey,
} from "./registry.js";

export interface CrmCommandServicePort {
  updateCase(
    actor: CrmActorContext,
    caseId: string,
    expectedVersion: number,
    input: UpdateCaseBody,
  ): Promise<CrmCaseDetail>;
  createEmployer(
    actor: CrmActorContext,
    idempotencyKey: string,
    input: CreateEmployerBody,
  ): Promise<IdempotentCrmResult<CrmEmployerDetail>>;
  createReferral(
    actor: CrmActorContext,
    idempotencyKey: string,
    input: CreateReferralBody,
  ): Promise<IdempotentCrmResult<CrmReferralDetail>>;
  transitionReferral(
    actor: CrmActorContext,
    referralId: string,
    expectedVersion: number,
    input: TransitionReferralBody,
  ): Promise<CrmReferralDetail>;
  createTask(
    actor: CrmActorContext,
    idempotencyKey: string,
    input: CreateTaskBody,
  ): Promise<IdempotentCrmResult<CrmTaskDetail>>;
  updateTask(
    actor: CrmActorContext,
    taskId: string,
    expectedVersion: number,
    input: UpdateTaskBody,
  ): Promise<CrmTaskDetail>;
}

export interface CreateCrmCommandServiceOptions {
  readonly repository: CrmCommandRepositoryPort;
  readonly authorization: CrmAuthorizationPort;
  readonly requestHashingKey: string;
}

function assertExpectedVersion(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new AppError(422, "invalid_expected_version", "Версия должна быть целым числом больше нуля");
  }
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Readonly<Record<string, unknown>>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}

function hashRequest(key: string, operation: CrmCommandOperationKey, input: unknown): string {
  return createHmac("sha256", key).update(operation).update("\0").update(stableJson(input)).digest("hex");
}

function handleMutation<T>(result: CrmMutationResult<T>, expectedVersion: number, label: string): T {
  switch (result.kind) {
    case "updated":
      return result.value;
    case "not_found":
      throw new AppError(404, "not_found", `${label} не найден`);
    case "version_conflict":
      throw new AppError(409, "version_conflict", `${label} уже изменён`, {
        details: { expectedVersion, currentVersion: result.currentVersion },
      });
    case "state_conflict":
      throw new AppError(409, "state_conflict", `Состояние ${label.toLocaleLowerCase("ru-RU")} изменилось`, {
        details: {
          expectedVersion,
          currentVersion: result.currentVersion,
          currentState: result.currentState,
        },
      });
    case "guard_failed":
      throw new AppError(422, "command_guard_failed", "Не выполнены условия операции", {
        errors: result.errors,
      });
  }
}

function operationForAuthorization(operation: CrmCommandOperationDefinition): CrmOperationDefinition {
  return operation as unknown as CrmOperationDefinition;
}

export function createCrmCommandService(options: CreateCrmCommandServiceOptions): CrmCommandServicePort {
  if (options.requestHashingKey.length < 32) {
    throw new Error("CRM command request hashing key must contain at least 32 characters");
  }

  const authorize = async (
    key: CrmCommandOperationKey,
    actor: CrmActorContext,
    resource?: CrmResourceReference,
  ) => {
    const operation = CRM_COMMAND_OPERATIONS[key];
    return options.authorization.authorize({
      actor,
      operation: operationForAuthorization(operation),
      permissionCode: operation.permissionCode,
      ...(resource ? { resource } : {}),
    });
  };

  const service: CrmCommandServicePort = {
    async updateCase(actor, caseId, expectedVersion, input) {
      assertExpectedVersion(expectedVersion);
      if (input.title !== undefined && !input.title.trim()) {
        throw new AppError(422, "case_title_required", "Название кейса не может быть пустым");
      }
      if (
        input.title === undefined &&
        input.nextStep === undefined &&
        input.ownerEmployeeProfileId === undefined &&
        input.relocation === undefined
      ) {
        throw new AppError(422, "empty_update", "Укажите хотя бы одно изменяемое поле");
      }
      const access = await authorize("cases.update", actor, { type: "crm_case", id: caseId });
      if (input.ownerEmployeeProfileId === null && access.visibility !== "all") {
        throw new AppError(
          422,
          "case_owner_required_for_scoped_actor",
          "Сотрудник с ограниченной областью видимости не может оставить кейс без ответственного",
        );
      }
      return handleMutation(
        await options.repository.updateCase({ actor, access, resourceId: caseId, expectedVersion, input }),
        expectedVersion,
        "CRM-кейс",
      );
    },

    async createEmployer(actor, idempotencyKey, input) {
      if (!input.name.trim()) {
        throw new AppError(422, "employer_name_required", "Название работодателя не может быть пустым");
      }
      if (!input.taxId && !input.manualReviewReason?.trim()) {
        throw new AppError(422, "manual_review_reason_required", "Для работодателя без ИНН укажите причину");
      }
      if ((input.contacts ?? []).filter((contact) => contact.isPrimary).length > 1) {
        throw new AppError(422, "multiple_primary_contacts", "Основным может быть только один контакт");
      }
      if ((input.contacts ?? []).some((contact) => !contact.name.trim())) {
        throw new AppError(422, "employer_contact_name_required", "У контакта должно быть имя");
      }
      const access = await authorize("employers.create", actor);
      return options.repository.createEmployer({
        actor,
        access,
        idempotencyKey,
        requestHash: hashRequest(options.requestHashingKey, "employers.create", input),
        input,
      });
    },

    async createReferral(actor, idempotencyKey, input) {
      const access = await authorize("referrals.create", actor);
      return options.repository.createReferral({
        actor,
        access,
        idempotencyKey,
        requestHash: hashRequest(options.requestHashingKey, "referrals.create", input),
        input,
      });
    },

    async transitionReferral(actor, referralId, expectedVersion, input) {
      assertExpectedVersion(expectedVersion);
      const access = await authorize("referrals.transition", actor, {
        type: "employer_referral",
        id: referralId,
      });
      return handleMutation(
        await options.repository.transitionReferral({
          actor,
          access,
          resourceId: referralId,
          expectedVersion,
          input,
        }),
        expectedVersion,
        "Направление работодателю",
      );
    },

    async createTask(actor, idempotencyKey, input) {
      if (!input.title.trim() || (input.checklist ?? []).some((item) => !item.title.trim())) {
        throw new AppError(
          422,
          "task_title_required",
          "Название задачи и пунктов чек-листа не может быть пустым",
        );
      }
      if (Boolean(input.caseId) === Boolean(input.employerReferralId)) {
        throw new AppError(
          422,
          "linked_crm_object_required",
          "Задача должна быть связана ровно с одним CRM-кейсом или направлением",
        );
      }
      const access = await authorize("tasks.create", actor);
      return options.repository.createTask({
        actor,
        access,
        idempotencyKey,
        requestHash: hashRequest(options.requestHashingKey, "tasks.create", input),
        input,
      });
    },

    async updateTask(actor, taskId, expectedVersion, input) {
      assertExpectedVersion(expectedVersion);
      if (
        (input.title !== undefined && !input.title.trim()) ||
        (input.checklist ?? []).some((item) => !item.title.trim())
      ) {
        throw new AppError(
          422,
          "task_title_required",
          "Название задачи и пунктов чек-листа не может быть пустым",
        );
      }
      const mutable = { ...input } as Record<string, unknown>;
      delete mutable.reason;
      if (Object.values(mutable).every((value) => value === undefined)) {
        throw new AppError(422, "empty_update", "Укажите хотя бы одно изменяемое поле");
      }
      const access = await authorize("tasks.update", actor, { type: "crm_task", id: taskId });
      return handleMutation(
        await options.repository.updateTask({ actor, access, resourceId: taskId, expectedVersion, input }),
        expectedVersion,
        "Задача CRM",
      );
    },
  };

  return Object.freeze(service);
}
