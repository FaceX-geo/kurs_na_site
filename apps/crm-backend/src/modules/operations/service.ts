import { AppError } from "../../common/errors.js";
import { boundedLimit, decodeCursor, encodeCursor, type Page } from "../../common/pagination.js";
import type {
  AuditEvent,
  AuditEventListQuery,
  MigrationConflict,
  MigrationConflictListQuery,
  MigrationRun,
  MigrationRunListQuery,
} from "./contracts.js";
import { renderPrometheusMetrics } from "./metrics.js";
import type {
  OperationsActorContext,
  OperationsAuthorizationPort,
  OperationsReadRepositoryPort,
  OperationsReadServicePort,
  OperationsRepositoryPage,
} from "./ports.js";
import { OPERATIONS, type OperationsOperationKey } from "./registry.js";

export interface OperationsReadServiceOptions {
  readonly authorization: OperationsAuthorizationPort;
  readonly repository: OperationsReadRepositoryPort;
  readonly cursorSigningKey: string;
}

function buildPage<T>(result: OperationsRepositoryPage<T>, limit: number, cursorSigningKey: string): Page<T> {
  if (result.hasMore && result.nextCursor === null) {
    throw new AppError(500, "pagination_contract_violation", "Не удалось построить страницу реестра");
  }
  return {
    items: [...result.items],
    page: {
      limit,
      hasMore: result.hasMore,
      nextCursor:
        result.hasMore && result.nextCursor ? encodeCursor(result.nextCursor, cursorSigningKey) : null,
    },
  };
}

export class OperationsReadService implements OperationsReadServicePort {
  private readonly authorization: OperationsAuthorizationPort;
  private readonly repository: OperationsReadRepositoryPort;
  private readonly cursorSigningKey: string;

  constructor(options: OperationsReadServiceOptions) {
    if (options.cursorSigningKey.length < 32) {
      throw new Error("Operations read-model cursor signing key must contain at least 32 characters");
    }
    this.authorization = options.authorization;
    this.repository = options.repository;
    this.cursorSigningKey = options.cursorSigningKey;
  }

  private authorize(actor: OperationsActorContext, key: OperationsOperationKey) {
    return this.authorization.authorize(actor, OPERATIONS[key]);
  }

  async listMigrationRuns(
    actor: OperationsActorContext,
    query: MigrationRunListQuery,
  ): Promise<Page<MigrationRun>> {
    const access = await this.authorize(actor, "migration.runs.list");
    const limit = boundedLimit(query.limit);
    const cursor = decodeCursor(query.cursor, this.cursorSigningKey);
    const { cursor: _cursor, limit: _limit, ...filters } = query;
    const result = await this.repository.listMigrationRuns(access, { ...filters, cursor, limit });
    return buildPage(result, limit, this.cursorSigningKey);
  }

  async getMigrationRun(actor: OperationsActorContext, runId: string): Promise<MigrationRun> {
    const access = await this.authorize(actor, "migration.runs.get");
    const result = await this.repository.getMigrationRun(access, runId);
    if (!result) {
      throw new AppError(404, "migration_run_not_found", "Запуск миграции не найден");
    }
    return result;
  }

  async listMigrationConflicts(
    actor: OperationsActorContext,
    query: MigrationConflictListQuery,
  ): Promise<Page<MigrationConflict>> {
    const access = await this.authorize(actor, "migration.conflicts.list");
    const limit = boundedLimit(query.limit);
    const cursor = decodeCursor(query.cursor, this.cursorSigningKey);
    const { cursor: _cursor, limit: _limit, ...filters } = query;
    const result = await this.repository.listMigrationConflicts(access, { ...filters, cursor, limit });
    return buildPage(result, limit, this.cursorSigningKey);
  }

  async getMigrationConflict(actor: OperationsActorContext, conflictId: string): Promise<MigrationConflict> {
    const access = await this.authorize(actor, "migration.conflicts.get");
    const result = await this.repository.getMigrationConflict(access, conflictId);
    if (!result) {
      throw new AppError(404, "migration_conflict_not_found", "Конфликт миграции не найден");
    }
    return result;
  }

  async listAuditEvents(
    actor: OperationsActorContext,
    query: AuditEventListQuery,
  ): Promise<Page<AuditEvent>> {
    if (query.from && query.to && new Date(query.from) > new Date(query.to)) {
      throw new AppError(422, "invalid_audit_period", "Начало периода аудита позже окончания");
    }
    const access = await this.authorize(actor, "audit.events.list");
    const limit = boundedLimit(query.limit);
    const cursor = decodeCursor(query.cursor, this.cursorSigningKey);
    const { cursor: _cursor, limit: _limit, ...filters } = query;
    const result = await this.repository.listAuditEvents(access, { ...filters, cursor, limit });
    return buildPage(result, limit, this.cursorSigningKey);
  }

  async readMetrics(actor: OperationsActorContext): Promise<string> {
    const access = await this.authorize(actor, "metrics.read");
    if (access.visibility !== "all") {
      throw new AppError(403, "permission_scope_denied", "Метрики доступны только в полном platform scope");
    }
    return renderPrometheusMetrics(await this.repository.readMetrics(access));
  }
}

export function createOperationsReadService(options: OperationsReadServiceOptions): OperationsReadService {
  return new OperationsReadService(options);
}
