export type CrmOperationsHttpMethod = "GET" | "POST" | "PATCH";

export type CrmOperationsOperationKey =
  | "communications.create"
  | "communications.update"
  | "communications.confirm"
  | "communications.queue"
  | "dashboard.get"
  | "notifications.list"
  | "notifications.read"
  | "reports.run"
  | "reports.list"
  | "reports.get"
  | "reports.export"
  | "settings.get"
  | "settings.update";

export interface CrmOperationsOperationDefinition {
  readonly key: CrmOperationsOperationKey;
  readonly operationId: string;
  readonly method: CrmOperationsHttpMethod;
  readonly path: string;
  readonly permissionCode:
    | "crm.communication.manage"
    | "crm.communication.confirm"
    | "crm.communication.send"
    | "crm.dashboard.read"
    | "crm.notification.read"
    | "crm.report.build"
    | "crm.report.export"
    | "crm.settings.manage";
  readonly resourceType: "crm_activity" | "crm_configuration";
  readonly summary: string;
}

const operationDefinitions = [
  {
    key: "communications.create",
    operationId: "CreateCommunicationDraft",
    method: "POST",
    path: "/internal/v1/crm/communication-drafts",
    permissionCode: "crm.communication.manage",
    resourceType: "crm_activity",
    summary: "Создать черновик коммуникации без внешней доставки",
  },
  {
    key: "communications.update",
    operationId: "UpdateCommunicationDraft",
    method: "PATCH",
    path: "/internal/v1/crm/communication-drafts/:draftId",
    permissionCode: "crm.communication.manage",
    resourceType: "crm_activity",
    summary: "Изменить свой черновик коммуникации",
  },
  {
    key: "communications.confirm",
    operationId: "ConfirmCommunicationDraft",
    method: "POST",
    path: "/internal/v1/crm/communication-drafts/:draftId/approvals",
    permissionCode: "crm.communication.confirm",
    resourceType: "crm_activity",
    summary: "Подтвердить черновик вторым сотрудником без постановки в доставку",
  },
  {
    key: "communications.queue",
    operationId: "QueueCommunication",
    method: "POST",
    path: "/internal/v1/crm/communication-drafts/:draftId/queue",
    permissionCode: "crm.communication.send",
    resourceType: "crm_activity",
    summary: "Атомарно поставить подтверждённую коммуникацию во внутреннюю durable-очередь",
  },
  {
    key: "dashboard.get",
    operationId: "GetCrmDashboard",
    method: "GET",
    path: "/internal/v1/crm/dashboard",
    permissionCode: "crm.dashboard.read",
    resourceType: "crm_configuration",
    summary: "Персональная сводка CRM в доступной области",
  },
  {
    key: "notifications.list",
    operationId: "ListNotifications",
    method: "GET",
    path: "/internal/v1/crm/notifications",
    permissionCode: "crm.notification.read",
    resourceType: "crm_activity",
    summary: "Реестр собственных CRM-уведомлений",
  },
  {
    key: "notifications.read",
    operationId: "MarkCrmNotificationRead",
    method: "POST",
    path: "/internal/v1/crm/notifications/:notificationId/read",
    permissionCode: "crm.notification.read",
    resourceType: "crm_activity",
    summary: "Отметить собственное CRM-уведомление прочитанным",
  },
  {
    key: "reports.run",
    operationId: "BuildCrmReport",
    method: "POST",
    path: "/internal/v1/crm/report-runs",
    permissionCode: "crm.report.build",
    resourceType: "crm_configuration",
    summary: "Построить versioned CRM-отчёт в доступной области",
  },
  {
    key: "reports.list",
    operationId: "ListCrmReportRuns",
    method: "GET",
    path: "/internal/v1/crm/report-runs",
    permissionCode: "crm.report.build",
    resourceType: "crm_configuration",
    summary: "Реестр собственных запусков CRM-отчётов",
  },
  {
    key: "reports.get",
    operationId: "GetCrmReportRun",
    method: "GET",
    path: "/internal/v1/crm/report-runs/:reportRunId",
    permissionCode: "crm.report.build",
    resourceType: "crm_configuration",
    summary: "Результат собственного запуска CRM-отчёта",
  },
  {
    key: "reports.export",
    operationId: "ExportCrmReport",
    method: "POST",
    path: "/internal/v1/crm/report-runs/:reportRunId/exports",
    permissionCode: "crm.report.export",
    resourceType: "crm_configuration",
    summary: "Экспортировать сохранённый агрегированный CRM-отчёт в ограниченный CSV",
  },
  {
    key: "settings.get",
    operationId: "GetCrmSettingVersion",
    method: "GET",
    path: "/internal/v1/crm/settings/:settingCode",
    permissionCode: "crm.settings.manage",
    resourceType: "crm_configuration",
    summary: "Последняя версия зарегистрированной настройки CRM",
  },
  {
    key: "settings.update",
    operationId: "UpdateCrmSettings",
    method: "PATCH",
    path: "/internal/v1/crm/settings/:settingCode",
    permissionCode: "crm.settings.manage",
    resourceType: "crm_configuration",
    summary: "Создать новую неизменяемую версию настройки CRM",
  },
] as const satisfies readonly CrmOperationsOperationDefinition[];

function buildOperationRegistry(
  operations: readonly CrmOperationsOperationDefinition[],
): Readonly<Record<CrmOperationsOperationKey, CrmOperationsOperationDefinition>> {
  const result = new Map<CrmOperationsOperationKey, CrmOperationsOperationDefinition>();
  const operationIds = new Set<string>();
  const routes = new Set<string>();
  for (const operation of operations) {
    if (result.has(operation.key)) throw new Error(`Duplicate CRM operations key: ${operation.key}`);
    if (operationIds.has(operation.operationId)) {
      throw new Error(`Duplicate CRM operations operationId: ${operation.operationId}`);
    }
    const route = `${operation.method} ${operation.path}`;
    if (routes.has(route)) throw new Error(`Duplicate CRM operations route: ${route}`);
    result.set(operation.key, Object.freeze({ ...operation }));
    operationIds.add(operation.operationId);
    routes.add(route);
  }
  return Object.freeze(
    Object.fromEntries(result) as Record<CrmOperationsOperationKey, CrmOperationsOperationDefinition>,
  );
}

export const CRM_OPERATIONS_OPERATIONS = buildOperationRegistry(operationDefinitions);
export const CRM_OPERATIONS_OPERATION_LIST = Object.freeze(Object.values(CRM_OPERATIONS_OPERATIONS));

export const CRM_REPORT_DEFINITIONS = Object.freeze({
  "pipeline.summary": Object.freeze({ formulaVersion: "pipeline.summary@1" }),
  "workload.summary": Object.freeze({ formulaVersion: "workload.summary@1" }),
  "referrals.outcomes": Object.freeze({ formulaVersion: "referrals.outcomes@1" }),
  "applications.sources": Object.freeze({ formulaVersion: "applications.sources@1" }),
  "employers.activity": Object.freeze({ formulaVersion: "employers.activity@1" }),
  "relocation.results": Object.freeze({ formulaVersion: "relocation.results@1" }),
  "data_quality.summary": Object.freeze({ formulaVersion: "data_quality.summary@1" }),
});
export type CrmReportCode = keyof typeof CRM_REPORT_DEFINITIONS;

export const CRM_SETTING_DEFINITIONS = Object.freeze({
  "crm.communication.policy": Object.freeze({ schemaVersion: "communication-policy@1" }),
  "crm.dashboard.policy": Object.freeze({ schemaVersion: "dashboard-policy@1" }),
  "crm.report.policy": Object.freeze({ schemaVersion: "report-policy@1" }),
});
export type CrmSettingCode = keyof typeof CRM_SETTING_DEFINITIONS;
