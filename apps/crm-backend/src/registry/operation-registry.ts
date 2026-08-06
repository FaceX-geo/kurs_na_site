export type CrmHttpMethod = "GET" | "POST" | "PATCH";

export type CrmOperationKey =
  | "cases.list"
  | "cases.get"
  | "cases.transition"
  | "people.list"
  | "people.summary"
  | "employers.list"
  | "employers.get"
  | "referrals.list"
  | "referrals.get"
  | "tasks.list"
  | "tasks.get"
  | "tasks.transition"
  | "activities.list"
  | "timeline.list"
  | "dictionaries.list"
  | "funnels.list"
  | "funnels.get";

export interface CrmOperationDefinition {
  readonly key: CrmOperationKey;
  readonly operationId: string;
  readonly method: CrmHttpMethod;
  readonly path: string;
  readonly permissionCode: string;
  readonly resourceType:
    | "crm_case"
    | "person"
    | "employer"
    | "employer_referral"
    | "crm_task"
    | "crm_activity"
    | "crm_configuration";
  readonly summary: string;
}

const definitions = [
  {
    key: "cases.list",
    operationId: "ListCases",
    method: "GET",
    path: "/internal/v1/crm/cases",
    permissionCode: "crm.case.list",
    resourceType: "crm_case",
    summary: "Список CRM-кейсов",
  },
  {
    key: "cases.get",
    operationId: "GetCase",
    method: "GET",
    path: "/internal/v1/crm/cases/:caseId",
    permissionCode: "crm.case.read",
    resourceType: "crm_case",
    summary: "Карточка CRM-кейса",
  },
  {
    key: "cases.transition",
    operationId: "TransitionCase",
    method: "POST",
    path: "/internal/v1/crm/cases/:caseId/transitions",
    permissionCode: "crm.case.transition",
    resourceType: "crm_case",
    summary: "Переход CRM-кейса",
  },
  {
    key: "people.list",
    operationId: "ListCrmPeople",
    method: "GET",
    path: "/internal/v1/crm/people",
    permissionCode: "crm.case.list",
    resourceType: "person",
    summary: "Реестр людей CRM",
  },
  {
    key: "people.summary",
    operationId: "GetCandidateSummary",
    method: "GET",
    path: "/internal/v1/crm/people/:personId/summary",
    permissionCode: "crm.case.read",
    resourceType: "person",
    summary: "Сводка кандидата",
  },
  {
    key: "employers.list",
    operationId: "ListEmployers",
    method: "GET",
    path: "/internal/v1/crm/employers",
    permissionCode: "crm.employer.read",
    resourceType: "employer",
    summary: "Реестр работодателей",
  },
  {
    key: "employers.get",
    operationId: "GetEmployer",
    method: "GET",
    path: "/internal/v1/crm/employers/:employerId",
    permissionCode: "crm.employer.read",
    resourceType: "employer",
    summary: "Карточка работодателя",
  },
  {
    key: "referrals.list",
    operationId: "ListEmployerReferrals",
    method: "GET",
    path: "/internal/v1/crm/referrals",
    permissionCode: "crm.case.read",
    resourceType: "employer_referral",
    summary: "Реестр направлений работодателям",
  },
  {
    key: "referrals.get",
    operationId: "GetEmployerReferral",
    method: "GET",
    path: "/internal/v1/crm/referrals/:referralId",
    permissionCode: "crm.case.read",
    resourceType: "employer_referral",
    summary: "Карточка направления работодателю",
  },
  {
    key: "tasks.list",
    operationId: "ListCrmTasks",
    method: "GET",
    path: "/internal/v1/crm/tasks",
    permissionCode: "crm.task.read",
    resourceType: "crm_task",
    summary: "Реестр задач CRM",
  },
  {
    key: "tasks.get",
    operationId: "GetCrmTask",
    method: "GET",
    path: "/internal/v1/crm/tasks/:taskId",
    permissionCode: "crm.task.read",
    resourceType: "crm_task",
    summary: "Карточка задачи CRM",
  },
  {
    key: "tasks.transition",
    operationId: "TransitionCrmTask",
    method: "POST",
    path: "/internal/v1/crm/tasks/:taskId/transitions",
    permissionCode: "crm.task.manage",
    resourceType: "crm_task",
    summary: "Переход задачи CRM",
  },
  {
    key: "activities.list",
    operationId: "ListCrmActivities",
    method: "GET",
    path: "/internal/v1/crm/activities",
    permissionCode: "crm.communication.read",
    resourceType: "crm_activity",
    summary: "Лента активностей CRM",
  },
  {
    key: "timeline.list",
    operationId: "ListCaseTimeline",
    method: "GET",
    path: "/internal/v1/crm/cases/:caseId/timeline",
    permissionCode: "crm.case.read",
    resourceType: "crm_activity",
    summary: "Хронология CRM-кейса",
  },
  {
    key: "dictionaries.list",
    operationId: "ListCrmDictionaries",
    method: "GET",
    path: "/internal/v1/crm/dictionaries",
    permissionCode: "crm.case.list",
    resourceType: "crm_configuration",
    summary: "Справочники CRM",
  },
  {
    key: "funnels.list",
    operationId: "ListCrmFunnels",
    method: "GET",
    path: "/internal/v1/crm/funnels",
    permissionCode: "crm.case.list",
    resourceType: "crm_configuration",
    summary: "Версии воронок CRM",
  },
  {
    key: "funnels.get",
    operationId: "GetCrmFunnel",
    method: "GET",
    path: "/internal/v1/crm/funnels/:funnelCode",
    permissionCode: "crm.case.list",
    resourceType: "crm_configuration",
    summary: "Версия воронки CRM",
  },
] as const satisfies readonly CrmOperationDefinition[];

function buildOperationRegistry(
  operations: readonly CrmOperationDefinition[],
): Readonly<Record<CrmOperationKey, CrmOperationDefinition>> {
  const byKey = new Map<CrmOperationKey, CrmOperationDefinition>();
  const operationIds = new Set<string>();
  const routes = new Set<string>();

  for (const operation of operations) {
    if (!operation.permissionCode.trim()) {
      throw new Error(`CRM operation ${operation.key} has no permission code`);
    }
    if (byKey.has(operation.key)) {
      throw new Error(`Duplicate CRM operation key: ${operation.key}`);
    }
    if (operationIds.has(operation.operationId)) {
      throw new Error(`Duplicate CRM operationId: ${operation.operationId}`);
    }

    const routeKey = `${operation.method} ${operation.path}`;
    if (routes.has(routeKey)) {
      throw new Error(`Duplicate CRM route: ${routeKey}`);
    }

    byKey.set(operation.key, Object.freeze({ ...operation }));
    operationIds.add(operation.operationId);
    routes.add(routeKey);
  }

  if (byKey.size !== operations.length) {
    throw new Error("CRM operation registry is incomplete");
  }

  return Object.freeze(Object.fromEntries(byKey) as Record<CrmOperationKey, CrmOperationDefinition>);
}

export const CRM_OPERATIONS = buildOperationRegistry(definitions);

export const CRM_OPERATION_LIST: readonly CrmOperationDefinition[] = Object.freeze(
  Object.values(CRM_OPERATIONS),
);
