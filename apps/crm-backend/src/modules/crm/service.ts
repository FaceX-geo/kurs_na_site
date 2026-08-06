import { createHmac } from "node:crypto";
import { AppError } from "../../common/errors.js";
import { boundedLimit, decodeCursor, encodeCursor, type Page } from "../../common/pagination.js";
import type { CrmDictionaryRegistry } from "../../registry/crm-dictionary-registry.js";
import {
  CRM_TASK_STATE_MACHINE,
  type CrmStateMachineDefinition,
  type CrmStateRegistry,
} from "../../registry/crm-state-registry.js";
import { CRM_OPERATIONS, type CrmOperationKey } from "../../registry/operation-registry.js";
import type {
  CrmActivity,
  CrmActivityListQuery,
  CrmCandidateSummary,
  CrmCaseListQuery,
  CrmCaseTransitionBody,
  CrmDictionaryList,
  CrmEmployerDetail,
  CrmEmployerListQuery,
  CrmFunnel,
  CrmPersonListQuery,
  CrmReferralDetail,
  CrmReferralListQuery,
  CrmTaskDetail,
  CrmTaskListQuery,
  CrmTaskTransitionBody,
  CrmTimelineQuery,
} from "./contracts.js";
import type {
  CrmAccessScope,
  CrmActorContext,
  CrmAuthorizationPort,
  CrmMutationResult,
  CrmRepositoryPage,
  CrmRepositoryPort,
  CrmResourceReference,
  CrmServicePort,
} from "./ports.js";

export interface CreateCrmServiceOptions {
  readonly repository: CrmRepositoryPort;
  readonly authorization: CrmAuthorizationPort;
  readonly stateRegistry: CrmStateRegistry;
  readonly dictionaryRegistry: CrmDictionaryRegistry;
  readonly cursorSigningKey: string;
  readonly defaultPageSize?: number;
  readonly maximumPageSize?: number;
  readonly taskStateMachine?: { readonly code: string; readonly version: number };
}

function ensureSigningKey(signingKey: string): void {
  if (signingKey.length < 32) {
    throw new Error("CRM cursor signing key must contain at least 32 characters");
  }
}

function assertExpectedVersion(expectedVersion: number): void {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    throw new AppError(
      422,
      "invalid_expected_version",
      "Ожидаемая версия должна быть целым числом больше нуля",
    );
  }
}

function resource(type: CrmResourceReference["type"], id: string): CrmResourceReference {
  return { type, id };
}

function assertPageContract<T>(page: CrmRepositoryPage<T>): void {
  if (page.hasMore !== (page.nextCursor !== null)) {
    throw new AppError(
      500,
      "pagination_contract_violation",
      "Репозиторий вернул несогласованный курсор пагинации",
    );
  }
}

function mapPage<T>(page: CrmRepositoryPage<T>, limit: number, signingKey: string): Page<T> {
  assertPageContract(page);
  return {
    items: [...page.items],
    page: {
      limit,
      nextCursor: page.nextCursor ? encodeCursor(page.nextCursor, signingKey) : null,
      hasMore: page.hasMore,
    },
  };
}

function paginationSigningKey(
  signingKey: string,
  operationKey: CrmOperationKey,
  actor: CrmActorContext,
  filters: Readonly<Record<string, unknown>>,
): string {
  const normalizedFilters = Object.entries(filters)
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return createHmac("sha256", signingKey)
    .update(operationKey)
    .update("\0")
    .update(actor.userAccountId)
    .update("\0")
    .update(JSON.stringify(normalizedFilters))
    .digest("hex");
}

function toFunnel(machine: CrmStateMachineDefinition): CrmFunnel {
  return {
    code: machine.code,
    version: machine.version,
    title: machine.title,
    status: machine.status,
    source: machine.source,
    initialState: machine.initialState,
    states: machine.states.map((state) => ({ ...state })),
    transitions: machine.transitions.map((transition) => ({
      code: transition.code,
      from: [...transition.from],
      to: [...transition.to],
      permissionCode: transition.permissionCode,
      requiredFields: [...transition.requiredFields],
      reasonRequired: transition.reasonRequired,
      ...(transition.targetGuard ? { targetGuard: { ...transition.targetGuard } } : {}),
    })),
  };
}

function handleMutationResult<T>(
  result: CrmMutationResult<T>,
  expectedVersion: number,
  resourceName: string,
): T {
  switch (result.kind) {
    case "updated":
      return result.value;
    case "not_found":
      throw new AppError(404, "not_found", `${resourceName} не найден`);
    case "version_conflict":
      throw new AppError(409, "version_conflict", "Объект уже изменён другим запросом", {
        details: { expectedVersion, currentVersion: result.currentVersion },
      });
    case "state_conflict":
      throw new AppError(409, "state_conflict", "Состояние объекта изменилось", {
        details: {
          expectedVersion,
          currentVersion: result.currentVersion,
          currentState: result.currentState,
        },
      });
    case "guard_failed":
      throw new AppError(422, "transition_guard_failed", "Не выполнены условия перехода", {
        errors: result.errors,
      });
  }
}

export function createCrmService(options: CreateCrmServiceOptions): CrmServicePort {
  ensureSigningKey(options.cursorSigningKey);
  const defaultPageSize = boundedLimit(options.defaultPageSize, 50, 200);
  const maximumPageSize = boundedLimit(options.maximumPageSize, 200, 200);
  if (defaultPageSize > maximumPageSize) {
    throw new Error("CRM default page size cannot exceed maximum page size");
  }
  const taskStateMachine = options.taskStateMachine ?? CRM_TASK_STATE_MACHINE;

  const authorize = async (
    key: CrmOperationKey,
    actor: CrmActorContext,
    target?: CrmResourceReference,
    permissionCode?: string,
  ): Promise<CrmAccessScope> => {
    const operation = CRM_OPERATIONS[key];
    return options.authorization.authorize({
      actor,
      operation,
      permissionCode: permissionCode ?? operation.permissionCode,
      ...(target ? { resource: target } : {}),
    });
  };

  const paging = (cursor: string | undefined, requestedLimit: number | undefined, signingKey: string) => ({
    cursor: decodeCursor(cursor, signingKey),
    limit: boundedLimit(requestedLimit, defaultPageSize, maximumPageSize),
  });

  return Object.freeze({
    async listCases(actor: CrmActorContext, query: CrmCaseListQuery) {
      const access = await authorize("cases.list", actor);
      const { cursor, limit, ...filters } = query;
      const signingKey = paginationSigningKey(options.cursorSigningKey, "cases.list", actor, filters);
      const pageRequest = paging(cursor, limit, signingKey);
      const result = await options.repository.listCases(access, { ...filters, ...pageRequest });
      return mapPage(result, pageRequest.limit, signingKey);
    },

    async getCase(actor: CrmActorContext, caseId: string) {
      const access = await authorize("cases.get", actor, resource("crm_case", caseId));
      const value = await options.repository.getCase(access, caseId);
      if (!value) {
        throw new AppError(404, "not_found", "CRM-кейс не найден");
      }
      return value;
    },

    async transitionCase(
      actor: CrmActorContext,
      caseId: string,
      expectedVersion: number,
      body: CrmCaseTransitionBody,
    ) {
      assertExpectedVersion(expectedVersion);
      const target = resource("crm_case", caseId);
      let access = await authorize("cases.transition", actor, target);
      const current = await options.repository.getCase(access, caseId);
      if (!current) {
        throw new AppError(404, "not_found", "CRM-кейс не найден");
      }
      if (current.version !== expectedVersion) {
        throw new AppError(409, "version_conflict", "CRM-кейс уже изменён другим запросом", {
          details: { expectedVersion, currentVersion: current.version },
        });
      }

      const machine = options.stateRegistry.get("case", current.funnelCode, current.funnelVersion);
      if (!machine) {
        throw new AppError(409, "state_machine_version_unavailable", "Версия воронки не зарегистрирована", {
          details: { funnelCode: current.funnelCode, funnelVersion: current.funnelVersion },
        });
      }
      if (machine.status !== "active") {
        throw new AppError(409, "state_machine_not_active", "Воронка недоступна для изменений", {
          details: { funnelCode: machine.code, funnelVersion: machine.version, status: machine.status },
        });
      }

      const resolved = options.stateRegistry.resolveTransition(
        "case",
        current.funnelCode,
        current.funnelVersion,
        current.stageCode,
        body.toStageCode,
      );
      if (!resolved) {
        throw new AppError(422, "transition_not_allowed", "Переход между стадиями не разрешён", {
          details: { fromStageCode: current.stageCode, toStageCode: body.toStageCode },
        });
      }

      const hasReason = Boolean(body.reasonCode?.trim() || body.reasonText?.trim());
      if (resolved.transition.reasonRequired && !hasReason) {
        throw new AppError(422, "transition_reason_required", "Для перехода требуется причина", {
          errors: [
            {
              field: "reasonText",
              code: "required",
              message: "Укажите reasonCode или reasonText",
            },
          ],
        });
      }

      if (resolved.transition.permissionCode !== CRM_OPERATIONS["cases.transition"].permissionCode) {
        access = await authorize("cases.transition", actor, target, resolved.transition.permissionCode);
      }

      const evidence: Readonly<Record<string, unknown>> = {
        ...(body.evidence ?? {}),
        target_state: body.toStageCode,
        ...(body.reasonCode ? { reason_code: body.reasonCode } : {}),
        ...(body.reasonText ? { reason: body.reasonText } : {}),
      };
      const targetAggregateStatus =
        resolved.machine.states.find((state) => state.code === body.toStageCode)?.aggregateStatus ?? null;

      const result = await options.repository.transitionCase({
        aggregateId: current.id,
        expectedVersion,
        fromState: current.stageCode,
        toState: body.toStageCode,
        machineCode: current.funnelCode,
        machineVersion: current.funnelVersion,
        transition: resolved.transition,
        targetAggregateStatus,
        reasonCode: body.reasonCode ?? null,
        reasonText: body.reasonText ?? null,
        evidence,
        actor,
        access,
      });
      return handleMutationResult(result, expectedVersion, "CRM-кейс");
    },

    async listPeople(actor: CrmActorContext, query: CrmPersonListQuery) {
      const access = await authorize("people.list", actor);
      const { cursor, limit, ...filters } = query;
      const signingKey = paginationSigningKey(options.cursorSigningKey, "people.list", actor, filters);
      const pageRequest = paging(cursor, limit, signingKey);
      const result = await options.repository.listPeople(access, { ...filters, ...pageRequest });
      return mapPage(result, pageRequest.limit, signingKey);
    },

    async getCandidateSummary(actor: CrmActorContext, personId: string): Promise<CrmCandidateSummary> {
      const access = await authorize("people.summary", actor, resource("person", personId));
      const value = await options.repository.getCandidateSummary(access, personId);
      if (!value) {
        throw new AppError(404, "not_found", "Кандидат не найден");
      }
      return value;
    },

    async listEmployers(actor: CrmActorContext, query: CrmEmployerListQuery) {
      const access = await authorize("employers.list", actor);
      const { cursor, limit, ...filters } = query;
      const signingKey = paginationSigningKey(options.cursorSigningKey, "employers.list", actor, filters);
      const pageRequest = paging(cursor, limit, signingKey);
      const result = await options.repository.listEmployers(access, { ...filters, ...pageRequest });
      return mapPage(result, pageRequest.limit, signingKey);
    },

    async getEmployer(actor: CrmActorContext, employerId: string): Promise<CrmEmployerDetail> {
      const access = await authorize("employers.get", actor, resource("employer", employerId));
      const value = await options.repository.getEmployer(access, employerId);
      if (!value) {
        throw new AppError(404, "not_found", "Работодатель не найден");
      }
      return value;
    },

    async listReferrals(actor: CrmActorContext, query: CrmReferralListQuery) {
      const access = await authorize("referrals.list", actor);
      const { cursor, limit, ...filters } = query;
      const signingKey = paginationSigningKey(options.cursorSigningKey, "referrals.list", actor, filters);
      const pageRequest = paging(cursor, limit, signingKey);
      const result = await options.repository.listReferrals(access, { ...filters, ...pageRequest });
      return mapPage(result, pageRequest.limit, signingKey);
    },

    async getReferral(actor: CrmActorContext, referralId: string): Promise<CrmReferralDetail> {
      const access = await authorize("referrals.get", actor, resource("employer_referral", referralId));
      const value = await options.repository.getReferral(access, referralId);
      if (!value) {
        throw new AppError(404, "not_found", "Направление работодателю не найдено");
      }
      return value;
    },

    async listTasks(actor: CrmActorContext, query: CrmTaskListQuery) {
      const access = await authorize("tasks.list", actor);
      const { cursor, limit, ...filters } = query;
      const signingKey = paginationSigningKey(options.cursorSigningKey, "tasks.list", actor, filters);
      const pageRequest = paging(cursor, limit, signingKey);
      const result = await options.repository.listTasks(access, { ...filters, ...pageRequest });
      return mapPage(result, pageRequest.limit, signingKey);
    },

    async getTask(actor: CrmActorContext, taskId: string): Promise<CrmTaskDetail> {
      const access = await authorize("tasks.get", actor, resource("crm_task", taskId));
      const value = await options.repository.getTask(access, taskId);
      if (!value) {
        throw new AppError(404, "not_found", "Задача CRM не найдена");
      }
      return value;
    },

    async transitionTask(
      actor: CrmActorContext,
      taskId: string,
      expectedVersion: number,
      body: CrmTaskTransitionBody,
    ) {
      assertExpectedVersion(expectedVersion);
      const access = await authorize("tasks.transition", actor, resource("crm_task", taskId));
      const current = await options.repository.getTask(access, taskId);
      if (!current) {
        throw new AppError(404, "not_found", "Задача CRM не найдена");
      }
      if (current.version !== expectedVersion) {
        throw new AppError(409, "version_conflict", "Задача CRM уже изменена другим запросом", {
          details: { expectedVersion, currentVersion: current.version },
        });
      }

      const machine = options.stateRegistry.get("task", taskStateMachine.code, taskStateMachine.version);
      if (machine?.status !== "active") {
        throw new AppError(409, "state_machine_version_unavailable", "Версия процесса задач недоступна");
      }
      const resolved = options.stateRegistry.resolveTransition(
        "task",
        machine.code,
        machine.version,
        current.state,
        body.toState,
      );
      if (!resolved) {
        throw new AppError(422, "transition_not_allowed", "Переход задачи не разрешён", {
          details: { fromState: current.state, toState: body.toState },
        });
      }
      if (resolved.transition.reasonRequired && !body.reason?.trim()) {
        throw new AppError(422, "transition_reason_required", "Для перехода требуется причина", {
          errors: [{ field: "reason", code: "required", message: "Укажите причину" }],
        });
      }

      const evidence: Readonly<Record<string, unknown>> = {
        ...(body.evidence ?? {}),
        ...(body.reason ? { reason: body.reason } : {}),
      };
      const result = await options.repository.transitionTask({
        aggregateId: current.id,
        expectedVersion,
        fromState: current.state,
        toState: body.toState,
        machineCode: machine.code,
        machineVersion: machine.version,
        transition: resolved.transition,
        targetAggregateStatus: null,
        reasonCode: null,
        reasonText: body.reason ?? null,
        evidence,
        actor,
        access,
      });
      return handleMutationResult(result, expectedVersion, "Задача CRM");
    },

    async listActivities(actor: CrmActorContext, query: CrmActivityListQuery) {
      const access = await authorize("activities.list", actor);
      const { cursor, limit, ...filters } = query;
      const signingKey = paginationSigningKey(options.cursorSigningKey, "activities.list", actor, filters);
      const pageRequest = paging(cursor, limit, signingKey);
      const result = await options.repository.listActivities(access, { ...filters, ...pageRequest });
      return mapPage(result, pageRequest.limit, signingKey);
    },

    async listCaseTimeline(
      actor: CrmActorContext,
      caseId: string,
      query: CrmTimelineQuery,
    ): Promise<Page<CrmActivity>> {
      const access = await authorize("timeline.list", actor, resource("crm_case", caseId));
      const { cursor, limit, ...filters } = query;
      const signingKey = paginationSigningKey(options.cursorSigningKey, "timeline.list", actor, {
        caseId,
        ...filters,
      });
      const pageRequest = paging(cursor, limit, signingKey);
      const result = await options.repository.listCaseTimeline(access, caseId, {
        ...filters,
        ...pageRequest,
      });
      if (!result) {
        throw new AppError(404, "not_found", "CRM-кейс не найден");
      }
      return mapPage(result, pageRequest.limit, signingKey);
    },

    async listDictionaries(actor: CrmActorContext): Promise<CrmDictionaryList> {
      await authorize("dictionaries.list", actor);
      return {
        registryVersion: options.dictionaryRegistry.version,
        items: options.dictionaryRegistry.list().map((dictionary) => ({
          code: dictionary.code,
          version: dictionary.version,
          values: dictionary.values.map((value) => ({ ...value })),
        })),
      };
    },

    async listFunnels(actor: CrmActorContext): Promise<readonly CrmFunnel[]> {
      await authorize("funnels.list", actor);
      return options.stateRegistry.list("case").map(toFunnel);
    },

    async getFunnel(actor: CrmActorContext, funnelCode: string, version?: number) {
      await authorize("funnels.get", actor, resource("crm_configuration", funnelCode));
      const value = options.stateRegistry.get("case", funnelCode, version);
      if (!value) {
        throw new AppError(404, "not_found", "Воронка CRM не найдена");
      }
      return toFunnel(value);
    },
  });
}
