export type CrmCommandOperationKey =
  | "cases.update"
  | "employers.create"
  | "referrals.create"
  | "referrals.transition"
  | "tasks.create"
  | "tasks.update";

export interface CrmCommandOperationDefinition {
  readonly key: CrmCommandOperationKey;
  readonly operationId: string;
  readonly method: "POST" | "PATCH";
  readonly path: string;
  readonly permissionCode: string;
  readonly resourceType: "crm_case" | "employer" | "employer_referral" | "crm_task";
  readonly summary: string;
}

const definitions = [
  {
    key: "cases.update",
    operationId: "UpdateCase",
    method: "PATCH",
    path: "/internal/v1/crm/cases/:caseId",
    permissionCode: "crm.case.update",
    resourceType: "crm_case",
    summary: "Изменить карточку CRM-кейса",
  },
  {
    key: "employers.create",
    operationId: "CreateEmployer",
    method: "POST",
    path: "/internal/v1/crm/employers",
    permissionCode: "crm.employer.manage",
    resourceType: "employer",
    summary: "Создать работодателя",
  },
  {
    key: "referrals.create",
    operationId: "CreateEmployerReferral",
    method: "POST",
    path: "/internal/v1/crm/referrals",
    permissionCode: "crm.referral.manage",
    resourceType: "employer_referral",
    summary: "Создать направление работодателю",
  },
  {
    key: "referrals.transition",
    operationId: "TransitionEmployerReferral",
    method: "POST",
    path: "/internal/v1/crm/referrals/:referralId/transitions",
    permissionCode: "crm.referral.manage",
    resourceType: "employer_referral",
    summary: "Изменить результат направления работодателю",
  },
  {
    key: "tasks.create",
    operationId: "CreateCrmTask",
    method: "POST",
    path: "/internal/v1/crm/tasks",
    permissionCode: "crm.task.manage",
    resourceType: "crm_task",
    summary: "Создать CRM-задачу",
  },
  {
    key: "tasks.update",
    operationId: "UpdateCrmTask",
    method: "PATCH",
    path: "/internal/v1/crm/tasks/:taskId",
    permissionCode: "crm.task.manage",
    resourceType: "crm_task",
    summary: "Изменить CRM-задачу",
  },
] as const satisfies readonly CrmCommandOperationDefinition[];

const entries = new Map<CrmCommandOperationKey, CrmCommandOperationDefinition>();
const operationIds = new Set<string>();
const routes = new Set<string>();
for (const definition of definitions) {
  if (entries.has(definition.key) || operationIds.has(definition.operationId)) {
    throw new Error(`Duplicate CRM command definition: ${definition.key}`);
  }
  const route = `${definition.method} ${definition.path}`;
  if (routes.has(route)) throw new Error(`Duplicate CRM command route: ${route}`);
  entries.set(definition.key, Object.freeze({ ...definition }));
  operationIds.add(definition.operationId);
  routes.add(route);
}

export const CRM_COMMAND_OPERATIONS = Object.freeze(
  Object.fromEntries(entries) as Record<CrmCommandOperationKey, CrmCommandOperationDefinition>,
);
export const CRM_COMMAND_OPERATION_LIST = Object.freeze(Object.values(CRM_COMMAND_OPERATIONS));
