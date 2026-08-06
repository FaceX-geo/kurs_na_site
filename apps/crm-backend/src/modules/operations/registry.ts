export type OperationsHttpMethod = "GET";

export type OperationsOperationKey =
  | "migration.runs.list"
  | "migration.runs.get"
  | "migration.conflicts.list"
  | "migration.conflicts.get"
  | "audit.events.list"
  | "metrics.read";

export type OperationsScopeKind = "migration_run" | "audit_event" | "platform_metrics";

export interface OperationsOperationDefinition {
  readonly key: OperationsOperationKey;
  readonly operationId: string;
  readonly method: OperationsHttpMethod;
  readonly path: string;
  readonly permissionCode: string;
  readonly scopeKind: OperationsScopeKind;
  readonly summary: string;
  readonly tag: "migration" | "audit" | "system";
}

const definitions = [
  {
    key: "migration.runs.list",
    operationId: "ListMigrationRuns",
    method: "GET",
    path: "/internal/v1/migration/runs",
    permissionCode: "migration.run.read",
    scopeKind: "migration_run",
    summary: "Список запусков миграции",
    tag: "migration",
  },
  {
    key: "migration.runs.get",
    operationId: "GetMigrationRun",
    method: "GET",
    path: "/internal/v1/migration/runs/:runId",
    permissionCode: "migration.run.read",
    scopeKind: "migration_run",
    summary: "Карточка запуска миграции",
    tag: "migration",
  },
  {
    key: "migration.conflicts.list",
    operationId: "ListMigrationConflicts",
    method: "GET",
    path: "/internal/v1/migration/conflicts",
    permissionCode: "migration.conflict.read",
    scopeKind: "migration_run",
    summary: "Очередь конфликтов миграции",
    tag: "migration",
  },
  {
    key: "migration.conflicts.get",
    operationId: "GetMigrationConflict",
    method: "GET",
    path: "/internal/v1/migration/conflicts/:conflictId",
    permissionCode: "migration.conflict.read",
    scopeKind: "migration_run",
    summary: "Карточка конфликта миграции",
    tag: "migration",
  },
  {
    key: "audit.events.list",
    operationId: "ListAuditEvents",
    method: "GET",
    path: "/internal/v1/audit/events",
    permissionCode: "audit.events.read",
    scopeKind: "audit_event",
    summary: "Редактированный реестр событий аудита",
    tag: "audit",
  },
  {
    key: "metrics.read",
    operationId: "ReadPrometheusMetrics",
    method: "GET",
    path: "/metrics",
    permissionCode: "platform.metrics.read",
    scopeKind: "platform_metrics",
    summary: "Метрики приложения без персональных данных",
    tag: "system",
  },
] as const satisfies readonly OperationsOperationDefinition[];

function buildRegistry(
  operations: readonly OperationsOperationDefinition[],
): Readonly<Record<OperationsOperationKey, OperationsOperationDefinition>> {
  const keys = new Set<string>();
  const operationIds = new Set<string>();
  const routes = new Set<string>();

  for (const operation of operations) {
    const route = `${operation.method} ${operation.path}`;
    if (keys.has(operation.key) || operationIds.has(operation.operationId) || routes.has(route)) {
      throw new Error(`Duplicate operations read-model contract: ${operation.key}`);
    }
    if (!operation.permissionCode.trim()) {
      throw new Error(`Operations contract ${operation.key} has no permission`);
    }
    keys.add(operation.key);
    operationIds.add(operation.operationId);
    routes.add(route);
  }

  return Object.freeze(
    Object.fromEntries(
      operations.map((operation) => [operation.key, Object.freeze({ ...operation })]),
    ) as Record<OperationsOperationKey, OperationsOperationDefinition>,
  );
}

export const OPERATIONS = buildRegistry(definitions);

export const OPERATIONS_LIST: readonly OperationsOperationDefinition[] = Object.freeze(
  Object.values(OPERATIONS),
);
