import { createHash, createHmac } from "node:crypto";
import { AppError } from "../../common/errors.js";
import { boundedLimit, decodeCursor, encodeCursor, type Page } from "../../common/pagination.js";
import type { CrmOperationDefinition } from "../../registry/operation-registry.js";
import type { CrmActorContext, CrmAuthorizationPort, CrmResourceReference } from "../crm/ports.js";
import type {
  CommunicationDraft,
  CreateCommunicationDraftBody,
  Notification,
  QueueCommunicationBody,
  ReportExport,
  ReportRun,
  SettingConfig,
  UpdateCommunicationDraftBody,
} from "./contracts.js";
import type {
  CrmOperationsMutationResult,
  CrmOperationsRepositoryPage,
  CrmOperationsRepositoryPort,
  CrmOperationsServicePort,
} from "./ports.js";
import {
  CRM_OPERATIONS_OPERATIONS,
  CRM_REPORT_DEFINITIONS,
  CRM_SETTING_DEFINITIONS,
  type CrmOperationsOperationDefinition,
  type CrmOperationsOperationKey,
  type CrmSettingCode,
} from "./registry.js";

export interface CreateCrmOperationsServiceOptions {
  readonly repository: CrmOperationsRepositoryPort;
  readonly authorization: CrmAuthorizationPort;
  readonly cursorSigningKey: string;
  readonly requestHashingKey: string;
  readonly defaultPageSize?: number;
  readonly maximumPageSize?: number;
}

function assertKey(name: string, key: string): void {
  if (key.length < 32) throw new Error(`${name} must contain at least 32 characters`);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Readonly<Record<string, unknown>>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}

function requestHash(key: string, operation: CrmOperationsOperationKey, body: unknown): string {
  return createHmac("sha256", key).update(operation).update("\0").update(stableJson(body)).digest("hex");
}

const REPORT_EXPORT_COLUMNS: Readonly<Record<ReportRun["reportCode"], readonly string[]>> = Object.freeze({
  "pipeline.summary": ["stageCode", "status", "count"],
  "workload.summary": ["state", "count", "overdueCount"],
  "referrals.outcomes": ["stageCode", "count"],
  "applications.sources": ["sourceCode", "entryPointCode", "count"],
  "employers.activity": ["status", "employerCount", "referralCount"],
  "relocation.results": ["resultCode", "offerStatus", "employmentStatus", "count"],
  "data_quality.summary": ["profileState", "dataQualityState", "count"],
});

function csvCell(value: unknown): string {
  const text =
    value === null || value === undefined
      ? ""
      : typeof value === "object"
        ? stableJson(value)
        : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function buildReportExport(report: ReportRun): ReportExport {
  const columns = REPORT_EXPORT_COLUMNS[report.reportCode];
  const dimensions = Array.isArray(report.result.dimensions) ? report.result.dimensions.filter(isRecord) : [];
  const content = [
    columns.map(csvCell).join(","),
    ...dimensions.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
  ].join("\r\n");
  const byteSize = Buffer.byteLength(content, "utf8");
  if (byteSize > 5_000_000) {
    throw new AppError(
      422,
      "report_export_too_large",
      "Агрегированный CSV превышает лимит 5 МБ; сузьте фильтры отчёта",
    );
  }
  return {
    reportRunId: report.id,
    reportCode: report.reportCode,
    formulaVersion: report.formulaVersion,
    format: "csv",
    filename: `${report.reportCode}-${report.publicId}.csv`,
    mediaType: "text/csv; charset=utf-8",
    sha256: createHash("sha256").update(content).digest("hex"),
    byteSize,
    sourceDataFreshAt: report.dataFreshAt,
    content,
  };
}

function paginationKey(
  key: string,
  operation: CrmOperationsOperationKey,
  actor: CrmActorContext,
  filters: Readonly<Record<string, unknown>>,
): string {
  return createHmac("sha256", key)
    .update(operation)
    .update("\0")
    .update(actor.userAccountId)
    .update("\0")
    .update(stableJson(filters))
    .digest("hex");
}

function mapPage<T>(page: CrmOperationsRepositoryPage<T>, limit: number, signingKey: string): Page<T> {
  if (page.hasMore !== (page.nextCursor !== null)) {
    throw new AppError(500, "pagination_contract_violation", "Репозиторий вернул несогласованный курсор");
  }
  return {
    items: [...page.items],
    page: {
      limit,
      nextCursor: page.nextCursor ? encodeCursor(page.nextCursor, signingKey) : null,
      hasMore: page.hasMore,
    },
  };
}

function operationForAuthorization(operation: CrmOperationsOperationDefinition): CrmOperationDefinition {
  return operation as unknown as CrmOperationDefinition;
}

function assertExpectedVersion(value: number, allowZero = false): void {
  const minimum = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new AppError(
      422,
      "invalid_expected_version",
      `Версия должна быть целым числом не меньше ${minimum}`,
    );
  }
}

function handleMutation<T>(
  result: CrmOperationsMutationResult<T>,
  expectedVersion: number,
  label: string,
): T {
  switch (result.kind) {
    case "succeeded":
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
      throw new AppError(422, result.code, result.message, {
        ...(result.errors ? { errors: result.errors } : {}),
      });
  }
}

function assertTimezone(value: string): void {
  try {
    new Intl.DateTimeFormat("ru-RU", { timeZone: value }).format(new Date());
  } catch {
    throw new AppError(422, "invalid_timezone", "Неизвестная временная зона", {
      errors: [{ field: "timezone", code: "invalid", message: "Используйте IANA timezone" }],
    });
  }
}

function assertReason(reason: string): void {
  if (reason.trim().length < 3) {
    throw new AppError(422, "reason_required", "Укажите содержательную причину операции");
  }
}

function assertCommunicationCreate(body: CreateCommunicationDraftBody): void {
  assertReason(body.reason);
  if (!body.body.trim()) {
    throw new AppError(422, "communication_body_required", "Текст коммуникации не может быть пустым");
  }
  if (body.channel === "email" && !body.subject?.trim()) {
    throw new AppError(422, "email_subject_required", "Для email укажите тему письма");
  }
  if (body.channel === "max" && body.subject !== undefined) {
    throw new AppError(422, "subject_not_supported", "Канал MAX не использует тему сообщения");
  }
}

function assertCommunicationUpdate(body: UpdateCommunicationDraftBody): void {
  assertReason(body.reason);
  const mutable = { ...body } as Record<string, unknown>;
  delete mutable.reason;
  if (Object.values(mutable).every((value) => value === undefined)) {
    throw new AppError(422, "empty_update", "Укажите хотя бы одно изменяемое поле");
  }
  if (body.channel === "max" && body.subject !== undefined && body.subject !== null) {
    throw new AppError(422, "subject_not_supported", "Канал MAX не использует тему сообщения");
  }
  if (body.body !== undefined && !body.body.trim()) {
    throw new AppError(422, "communication_body_required", "Текст коммуникации не может быть пустым");
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertSettingConfig(settingCode: CrmSettingCode, config: SettingConfig): void {
  if (!isRecord(config)) {
    throw new AppError(422, "invalid_setting_config", "Конфигурация должна быть объектом");
  }
  const record: Readonly<Record<string, unknown>> = config;
  const keys = Object.keys(config).sort();
  const exactKeys = (expected: readonly string[]) =>
    keys.length === expected.length && expected.every((key) => keys.includes(key));
  switch (settingCode) {
    case "crm.communication.policy": {
      if (!exactKeys(["enabledChannels", "maxRecipientsPerDraft", "requiresFourEyes"])) {
        throw new AppError(422, "invalid_setting_config", "Некорректный контракт communication policy");
      }
      if (record.requiresFourEyes !== true) {
        throw new AppError(422, "four_eyes_cannot_be_disabled", "Принцип двух сотрудников обязателен");
      }
      if (
        !Number.isSafeInteger(record.maxRecipientsPerDraft) ||
        (record.maxRecipientsPerDraft as number) < 1 ||
        (record.maxRecipientsPerDraft as number) > 500 ||
        !Array.isArray(record.enabledChannels) ||
        record.enabledChannels.length < 1 ||
        record.enabledChannels.length > 2 ||
        new Set(record.enabledChannels).size !== record.enabledChannels.length ||
        !record.enabledChannels.every((channel) => channel === "email" || channel === "max")
      ) {
        throw new AppError(422, "invalid_setting_config", "Некорректные значения communication policy");
      }
      return;
    }
    case "crm.dashboard.policy":
      if (!exactKeys(["overdueWarningHours"])) {
        throw new AppError(422, "invalid_setting_config", "Некорректный контракт dashboard policy");
      }
      if (
        !Number.isSafeInteger(record.overdueWarningHours) ||
        (record.overdueWarningHours as number) < 1 ||
        (record.overdueWarningHours as number) > 720
      ) {
        throw new AppError(422, "invalid_setting_config", "Некорректные значения dashboard policy");
      }
      return;
    case "crm.report.policy":
      if (!exactKeys(["allowedTimezones", "retentionDays"])) {
        throw new AppError(422, "invalid_setting_config", "Некорректный контракт report policy");
      }
      if (
        !Number.isSafeInteger(record.retentionDays) ||
        (record.retentionDays as number) < 1 ||
        (record.retentionDays as number) > 3_650 ||
        !Array.isArray(record.allowedTimezones) ||
        record.allowedTimezones.length < 1 ||
        record.allowedTimezones.length > 100 ||
        !record.allowedTimezones.every((timezone) => typeof timezone === "string")
      ) {
        throw new AppError(422, "invalid_setting_config", "Некорректные значения report policy");
      }
      for (const timezone of record.allowedTimezones as readonly string[]) assertTimezone(timezone);
      return;
  }
}

export function createCrmOperationsService(
  options: CreateCrmOperationsServiceOptions,
): CrmOperationsServicePort {
  assertKey("CRM operations cursor signing key", options.cursorSigningKey);
  assertKey("CRM operations request hashing key", options.requestHashingKey);
  const defaultPageSize = boundedLimit(options.defaultPageSize, 50, 200);
  const maximumPageSize = boundedLimit(options.maximumPageSize, 200, 200);
  if (defaultPageSize > maximumPageSize) {
    throw new Error("CRM operations default page size cannot exceed maximum page size");
  }

  const authorize = async (
    key: CrmOperationsOperationKey,
    actor: CrmActorContext,
    resource?: CrmResourceReference,
  ) => {
    const operation = CRM_OPERATIONS_OPERATIONS[key];
    return options.authorization.authorize({
      actor,
      operation: operationForAuthorization(operation),
      permissionCode: operation.permissionCode,
      ...(resource ? { resource } : {}),
    });
  };

  const pageRequest = (
    actor: CrmActorContext,
    operation: CrmOperationsOperationKey,
    cursor: string | undefined,
    requestedLimit: number | undefined,
    filters: Readonly<Record<string, unknown>>,
  ) => {
    const signingKey = paginationKey(options.cursorSigningKey, operation, actor, filters);
    return {
      signingKey,
      cursor: decodeCursor(cursor, signingKey),
      limit: boundedLimit(requestedLimit, defaultPageSize, maximumPageSize),
    };
  };

  const service: CrmOperationsServicePort = {
    async createCommunicationDraft(actor, idempotencyKey, body) {
      assertCommunicationCreate(body);
      const access = await authorize("communications.create", actor);
      return options.repository.createCommunicationDraft({
        actor,
        access,
        input: body,
        idempotencyKey,
        requestHash: requestHash(options.requestHashingKey, "communications.create", body),
      });
    },

    async updateCommunicationDraft(actor, draftId, expectedVersion, body) {
      assertExpectedVersion(expectedVersion);
      assertCommunicationUpdate(body);
      const access = await authorize("communications.update", actor, { type: "crm_activity", id: draftId });
      return handleMutation(
        await options.repository.updateCommunicationDraft({
          actor,
          access,
          resourceId: draftId,
          expectedVersion,
          input: body,
        }),
        expectedVersion,
        "Черновик коммуникации",
      );
    },

    async confirmCommunicationDraft(actor, draftId, expectedVersion, body) {
      assertExpectedVersion(expectedVersion);
      assertReason(body.reason);
      const access = await authorize("communications.confirm", actor, { type: "crm_activity", id: draftId });
      return handleMutation(
        await options.repository.confirmCommunicationDraft({
          actor,
          access,
          resourceId: draftId,
          expectedVersion,
          input: body,
        }),
        expectedVersion,
        "Черновик коммуникации",
      );
    },

    async queueCommunication(actor, draftId, expectedVersion, idempotencyKey, body) {
      assertExpectedVersion(expectedVersion);
      assertReason(body.reason);
      const access = await authorize("communications.queue", actor, { type: "crm_activity", id: draftId });
      return options.repository.queueCommunication({
        actor,
        access,
        resourceId: draftId,
        expectedVersion,
        idempotencyKey,
        input: body,
        requestHash: requestHash(options.requestHashingKey, "communications.queue", {
          draftId,
          expectedVersion,
          ...body,
        } satisfies QueueCommunicationBody & { draftId: string; expectedVersion: number }),
      });
    },

    async getDashboardSummary(actor, query) {
      const timezone = query.timezone ?? "Europe/Moscow";
      assertTimezone(timezone);
      const access = await authorize("dashboard.get", actor);
      return options.repository.getDashboardSummary({ actor, access }, { timezone });
    },

    async listNotifications(actor, query) {
      const access = await authorize("notifications.list", actor);
      const { cursor, limit, ...filters } = query;
      const paging = pageRequest(actor, "notifications.list", cursor, limit, filters);
      const result = await options.repository.listNotifications(
        { actor, access },
        { ...filters, cursor: paging.cursor, limit: paging.limit },
      );
      return mapPage(result, paging.limit, paging.signingKey);
    },

    async markNotificationRead(actor, notificationId, expectedVersion) {
      assertExpectedVersion(expectedVersion);
      const access = await authorize("notifications.read", actor, {
        type: "crm_activity",
        id: notificationId,
      });
      return handleMutation(
        await options.repository.markNotificationRead({
          actor,
          access,
          resourceId: notificationId,
          expectedVersion,
        }),
        expectedVersion,
        "Уведомление",
      );
    },

    async runReport(actor, idempotencyKey, body) {
      assertReason(body.reason);
      assertTimezone(body.timezone);
      const access = await authorize("reports.run", actor);
      const definition = CRM_REPORT_DEFINITIONS[body.reportCode];
      return options.repository.runReport({
        actor,
        access,
        input: body,
        formulaVersion: definition.formulaVersion,
        idempotencyKey,
        requestHash: requestHash(options.requestHashingKey, "reports.run", body),
      });
    },

    async listReportRuns(actor, query) {
      const access = await authorize("reports.list", actor);
      const { cursor, limit, ...filters } = query;
      const paging = pageRequest(actor, "reports.list", cursor, limit, filters);
      const result = await options.repository.listReportRuns(
        { actor, access },
        { ...filters, cursor: paging.cursor, limit: paging.limit },
      );
      return mapPage(result, paging.limit, paging.signingKey);
    },

    async getReportRun(actor, reportRunId) {
      const access = await authorize("reports.get", actor, { type: "crm_configuration", id: reportRunId });
      const value = await options.repository.getReportRun({ actor, access }, reportRunId);
      if (!value) throw new AppError(404, "not_found", "Запуск отчёта не найден");
      return value;
    },

    async exportReport(actor, reportRunId, idempotencyKey) {
      const access = await authorize("reports.export", actor, {
        type: "crm_configuration",
        id: reportRunId,
      });
      const report = await options.repository.getReportRun({ actor, access }, reportRunId);
      if (!report) throw new AppError(404, "not_found", "Запуск отчёта не найден");
      const value = buildReportExport(report);
      const recorded = await options.repository.recordReportExport({
        actor,
        access,
        reportRunId: report.id,
        reportCode: report.reportCode,
        formulaVersion: report.formulaVersion,
        sha256: value.sha256,
        byteSize: value.byteSize,
        idempotencyKey,
        requestHash: requestHash(options.requestHashingKey, "reports.export", {
          reportRunId: report.id,
          format: "csv",
        }),
      });
      return { value, replayed: recorded.replayed };
    },

    async getSetting(actor, settingCode) {
      const access = await authorize("settings.get", actor, { type: "crm_configuration", id: settingCode });
      if (access.visibility !== "all") {
        throw new AppError(403, "global_scope_required", "Управление настройками требует global scope");
      }
      const value = await options.repository.getSetting({ actor, access }, settingCode);
      if (!value) throw new AppError(404, "not_found", "Настройка CRM ещё не создана");
      return value;
    },

    async updateSetting(actor, settingCode, expectedVersion, body) {
      assertExpectedVersion(expectedVersion, true);
      assertReason(body.reason);
      assertSettingConfig(settingCode, body.config);
      const access = await authorize("settings.update", actor, {
        type: "crm_configuration",
        id: settingCode,
      });
      if (access.visibility !== "all") {
        throw new AppError(403, "global_scope_required", "Управление настройками требует global scope");
      }
      return handleMutation(
        await options.repository.updateSetting({
          actor,
          access,
          resourceId: settingCode,
          settingCode,
          schemaVersion: CRM_SETTING_DEFINITIONS[settingCode].schemaVersion,
          expectedVersion,
          input: body,
        }),
        expectedVersion,
        "Настройка CRM",
      );
    },
  };
  return Object.freeze(service);
}

export type { CommunicationDraft, Notification, ReportRun };
