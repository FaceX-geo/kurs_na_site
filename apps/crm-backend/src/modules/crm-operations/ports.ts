import type { CursorValue, Page } from "../../common/pagination.js";
import type { CrmAccessScope, CrmActorContext } from "../crm/ports.js";
import type {
  CommunicationDraft,
  ConfirmCommunicationDraftBody,
  CreateCommunicationDraftBody,
  DashboardSummary,
  DashboardSummaryQuery,
  Notification,
  NotificationListQuery,
  QueueCommunicationBody,
  ReportExport,
  ReportRun,
  ReportRunListQuery,
  RunReportBody,
  SettingVersion,
  UpdateCommunicationDraftBody,
  UpdateSettingBody,
} from "./contracts.js";
import type { CrmReportCode, CrmSettingCode } from "./registry.js";

export interface CrmOperationsRepositoryPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: CursorValue | null;
  readonly hasMore: boolean;
}

export interface CrmOperationsPageRequest {
  readonly cursor: CursorValue | undefined;
  readonly limit: number;
}

export type NotificationRepositoryQuery = Omit<NotificationListQuery, "cursor" | "limit"> &
  CrmOperationsPageRequest;
export type ReportRunRepositoryQuery = Omit<ReportRunListQuery, "cursor" | "limit"> &
  CrmOperationsPageRequest;

export interface CrmOperationsContext {
  readonly actor: CrmActorContext;
  readonly access: CrmAccessScope;
}

export interface CrmOperationsCreateCommand<T> extends CrmOperationsContext {
  readonly input: T;
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

export interface CrmOperationsUpdateCommand<T> extends CrmOperationsContext {
  readonly resourceId: string;
  readonly expectedVersion: number;
  readonly input: T;
}

export interface CrmOperationsIdempotentUpdateCommand<T> extends CrmOperationsUpdateCommand<T> {
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

export type CrmOperationsMutationResult<T> =
  | { readonly kind: "succeeded"; readonly value: T }
  | { readonly kind: "not_found" }
  | { readonly kind: "version_conflict"; readonly currentVersion: number }
  | { readonly kind: "state_conflict"; readonly currentState: string; readonly currentVersion: number }
  | {
      readonly kind: "guard_failed";
      readonly code: string;
      readonly message: string;
      readonly errors?: readonly {
        readonly field: string;
        readonly code: string;
        readonly message: string;
      }[];
    };

export interface IdempotentCrmOperationsResult<T> {
  readonly value: T;
  readonly replayed: boolean;
}

export interface RunReportCommand extends CrmOperationsCreateCommand<RunReportBody> {
  readonly formulaVersion: string;
}

export interface UpdateSettingCommand extends CrmOperationsUpdateCommand<UpdateSettingBody> {
  readonly settingCode: CrmSettingCode;
  readonly schemaVersion: string;
}

export interface RecordReportExportCommand extends CrmOperationsContext {
  readonly reportRunId: string;
  readonly reportCode: CrmReportCode;
  readonly formulaVersion: string;
  readonly sha256: string;
  readonly byteSize: number;
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

export interface CrmOperationsRepositoryPort {
  createCommunicationDraft(
    command: CrmOperationsCreateCommand<CreateCommunicationDraftBody>,
  ): Promise<IdempotentCrmOperationsResult<CommunicationDraft>>;
  updateCommunicationDraft(
    command: CrmOperationsUpdateCommand<UpdateCommunicationDraftBody>,
  ): Promise<CrmOperationsMutationResult<CommunicationDraft>>;
  confirmCommunicationDraft(
    command: CrmOperationsUpdateCommand<ConfirmCommunicationDraftBody>,
  ): Promise<CrmOperationsMutationResult<CommunicationDraft>>;
  queueCommunication(
    command: CrmOperationsIdempotentUpdateCommand<QueueCommunicationBody>,
  ): Promise<IdempotentCrmOperationsResult<CommunicationDraft>>;

  getDashboardSummary(context: CrmOperationsContext, query: DashboardSummaryQuery): Promise<DashboardSummary>;

  listNotifications(
    context: CrmOperationsContext,
    query: NotificationRepositoryQuery,
  ): Promise<CrmOperationsRepositoryPage<Notification>>;
  markNotificationRead(
    command: Omit<CrmOperationsUpdateCommand<Record<string, never>>, "input">,
  ): Promise<CrmOperationsMutationResult<Notification>>;

  runReport(command: RunReportCommand): Promise<IdempotentCrmOperationsResult<ReportRun>>;
  listReportRuns(
    context: CrmOperationsContext,
    query: ReportRunRepositoryQuery,
  ): Promise<CrmOperationsRepositoryPage<ReportRun>>;
  getReportRun(context: CrmOperationsContext, reportRunId: string): Promise<ReportRun | null>;
  recordReportExport(command: RecordReportExportCommand): Promise<{ readonly replayed: boolean }>;

  getSetting(context: CrmOperationsContext, settingCode: CrmSettingCode): Promise<SettingVersion | null>;
  updateSetting(command: UpdateSettingCommand): Promise<CrmOperationsMutationResult<SettingVersion>>;
}

export interface CrmOperationsServicePort {
  createCommunicationDraft(
    actor: CrmActorContext,
    idempotencyKey: string,
    body: CreateCommunicationDraftBody,
  ): Promise<IdempotentCrmOperationsResult<CommunicationDraft>>;
  updateCommunicationDraft(
    actor: CrmActorContext,
    draftId: string,
    expectedVersion: number,
    body: UpdateCommunicationDraftBody,
  ): Promise<CommunicationDraft>;
  confirmCommunicationDraft(
    actor: CrmActorContext,
    draftId: string,
    expectedVersion: number,
    body: ConfirmCommunicationDraftBody,
  ): Promise<CommunicationDraft>;
  queueCommunication(
    actor: CrmActorContext,
    draftId: string,
    expectedVersion: number,
    idempotencyKey: string,
    body: QueueCommunicationBody,
  ): Promise<IdempotentCrmOperationsResult<CommunicationDraft>>;
  getDashboardSummary(actor: CrmActorContext, query: DashboardSummaryQuery): Promise<DashboardSummary>;
  listNotifications(actor: CrmActorContext, query: NotificationListQuery): Promise<Page<Notification>>;
  markNotificationRead(
    actor: CrmActorContext,
    notificationId: string,
    expectedVersion: number,
  ): Promise<Notification>;
  runReport(
    actor: CrmActorContext,
    idempotencyKey: string,
    body: RunReportBody,
  ): Promise<IdempotentCrmOperationsResult<ReportRun>>;
  listReportRuns(actor: CrmActorContext, query: ReportRunListQuery): Promise<Page<ReportRun>>;
  getReportRun(actor: CrmActorContext, reportRunId: string): Promise<ReportRun>;
  exportReport(
    actor: CrmActorContext,
    reportRunId: string,
    idempotencyKey: string,
  ): Promise<IdempotentCrmOperationsResult<ReportExport>>;
  getSetting(actor: CrmActorContext, settingCode: CrmSettingCode): Promise<SettingVersion>;
  updateSetting(
    actor: CrmActorContext,
    settingCode: CrmSettingCode,
    expectedVersion: number,
    body: UpdateSettingBody,
  ): Promise<SettingVersion>;
}

export type { CrmReportCode, CrmSettingCode };
