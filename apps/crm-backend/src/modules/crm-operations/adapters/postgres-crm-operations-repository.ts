import { createHash } from "node:crypto";
import { type Kysely, type RawBuilder, sql, type Transaction } from "kysely";
import { AppError } from "../../../common/errors.js";
import { newUuid } from "../../../common/id.js";
import type { Database } from "../../../db/types.js";
import {
  caseScopeSql,
  employerScopeSql,
  referralScopeSql,
  taskScopeSql,
} from "../../crm/adapters/postgres-crm-repository.js";
import type { CrmAccessScope } from "../../crm/ports.js";
import { appendAuditEvent } from "../../platform/audit.js";
import type {
  CommunicationDraft,
  CreateCommunicationDraftBody,
  DashboardSummary,
  Notification,
  QueueCommunicationBody,
  ReportRun,
  RunReportBody,
  SettingVersion,
  UpdateCommunicationDraftBody,
} from "../contracts.js";
import type {
  CrmOperationsContext,
  CrmOperationsCreateCommand,
  CrmOperationsIdempotentUpdateCommand,
  CrmOperationsMutationResult,
  CrmOperationsRepositoryPage,
  CrmOperationsRepositoryPort,
  CrmOperationsUpdateCommand,
  IdempotentCrmOperationsResult,
  NotificationRepositoryQuery,
  RecordReportExportCommand,
  ReportRunRepositoryQuery,
  RunReportCommand,
  UpdateSettingCommand,
} from "../ports.js";
import { CRM_SETTING_DEFINITIONS, type CrmReportCode, type CrmSettingCode } from "../registry.js";

type CrmExecutor = Kysely<Database> | Transaction<Database>;
type CrmTransaction = Transaction<Database>;

interface CommunicationDraftRow {
  id: string;
  public_id: string;
  channel: string;
  subject: string | null;
  body: string;
  selection_fingerprint: string;
  state: string;
  created_by_user_account_id: string;
  confirmed_by_user_account_id: string | null;
  confirmed_at: Date | string | null;
  queued_at: Date | string | null;
  version: number | string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface CommunicationDraftWithRecipientsRow extends CommunicationDraftRow {
  recipient_person_ids: string[];
}

interface NotificationRow {
  id: string;
  public_id: string;
  type_code: string;
  title: string;
  payload: unknown;
  read_at: Date | string | null;
  occurred_at: Date | string;
  created_at: Date | string;
}

interface ReportRunRow {
  id: string;
  public_id: string;
  report_code: string;
  formula_version: string;
  timezone: string;
  filters: unknown;
  scope_snapshot: unknown;
  state: string;
  result: unknown;
  excluded_records: number | string;
  data_fresh_at: Date | string;
  created_by_user_account_id: string;
  created_at: Date | string;
}

interface SettingRow {
  id: string;
  setting_code: string;
  version: number | string;
  config: unknown;
  state: string;
  reason: string;
  created_by_user_account_id: string;
  activated_at: Date | string | null;
  created_at: Date | string;
}

interface IdempotencyClaim {
  readonly replayedResourceId: string | null;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}

function toNumber(value: number | string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error(`Invalid numeric value: ${value}`);
  return result;
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function publicId(prefix: "communication" | "report"): string {
  return `${prefix}_${newUuid().replaceAll("-", "")}`;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function selectionFingerprint(personIds: readonly string[]): string {
  return createHash("sha256")
    .update(JSON.stringify(sortedUnique(personIds)))
    .digest("hex");
}

function uuidValues(values: readonly string[]): RawBuilder<unknown> {
  return sql.join(values.map((value) => sql`${value}::uuid`));
}

/** SQL scope applied before a person can enter a communication recipient snapshot. */
export function crmOperationsPersonScopeSql(
  access: CrmAccessScope,
  personAlias = "person_row",
): RawBuilder<boolean> {
  if (access.visibility === "all") return sql<boolean>`true`;
  const linkedCaseScope = caseScopeSql(access, "scope_case");
  return sql<boolean>`exists (
    select 1
    from crm.case_person scope_case_person
    join crm."case" scope_case on scope_case.id = scope_case_person.case_id
    where scope_case_person.person_id = ${sql.ref(`${personAlias}.id`)}
      and scope_case.archived_at is null
      and ${linkedCaseScope}
  )`;
}

function communicationRecipientScopeSql(
  access: CrmAccessScope,
  communicationAlias = "communication",
): RawBuilder<boolean> {
  const personScope = crmOperationsPersonScopeSql(access, "scope_person");
  return sql<boolean>`
    exists (
      select 1
      from crm.communication_recipient scope_recipient
      where scope_recipient.draft_id = ${sql.ref(`${communicationAlias}.id`)}
    )
    and not exists (
      select 1
      from crm.communication_recipient scope_recipient
      join identity.person scope_person on scope_person.id = scope_recipient.person_id
      where scope_recipient.draft_id = ${sql.ref(`${communicationAlias}.id`)}
        and (scope_person.archived_at is not null or not (${personScope}))
    )
  `;
}

function scopeSnapshot(access: CrmAccessScope): Record<string, unknown> {
  return {
    visibility: access.visibility,
    employeeProfileIds: [...access.employeeProfileIds],
    teamIds: [...access.teamIds],
    organizationUnitIds: [...access.organizationUnitIds],
  };
}

function publicScopeSnapshot(value: unknown): CrmAccessScope["visibility"] {
  const visibility = asObject(value).visibility;
  if (
    visibility === "assigned" ||
    visibility === "team" ||
    visibility === "department" ||
    visibility === "all"
  ) {
    return visibility;
  }
  throw new Error("Report scope snapshot has an invalid visibility");
}

function mapNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    publicId: row.public_id,
    typeCode: row.type_code,
    title: row.title,
    payload: asObject(row.payload),
    readAt: nullableIso(row.read_at),
    occurredAt: toIso(row.occurred_at),
    version: row.read_at === null ? 1 : 2,
  };
}

function mapReportRun(row: ReportRunRow): ReportRun {
  const reportCode = row.report_code as CrmReportCode;
  if (
    !(
      reportCode in
      {
        "pipeline.summary": 1,
        "workload.summary": 1,
        "referrals.outcomes": 1,
        "applications.sources": 1,
        "employers.activity": 1,
        "relocation.results": 1,
        "data_quality.summary": 1,
      }
    )
  ) {
    throw new Error(`Unknown report code: ${row.report_code}`);
  }
  return {
    id: row.id,
    publicId: row.public_id,
    reportCode,
    formulaVersion: row.formula_version,
    timezone: row.timezone,
    filters: asObject(row.filters),
    scopeVisibility: publicScopeSnapshot(row.scope_snapshot),
    state: row.state as ReportRun["state"],
    result: asObject(row.result),
    excludedRecords: toNumber(row.excluded_records),
    dataFreshAt: toIso(row.data_fresh_at),
    createdByUserAccountId: row.created_by_user_account_id,
    createdAt: toIso(row.created_at),
    version: 1,
  };
}

function mapSetting(row: SettingRow): SettingVersion {
  const settingCode = row.setting_code as CrmSettingCode;
  const definition = CRM_SETTING_DEFINITIONS[settingCode];
  if (!definition) throw new Error(`Unknown CRM setting code: ${row.setting_code}`);
  return {
    id: row.id,
    settingCode,
    schemaVersion: definition.schemaVersion,
    version: toNumber(row.version),
    config: asObject(row.config),
    state: row.state as SettingVersion["state"],
    reason: row.reason,
    createdByUserAccountId: row.created_by_user_account_id,
    activatedAt: nullableIso(row.activated_at),
    createdAt: toIso(row.created_at),
  };
}

async function appendOutbox(
  transaction: CrmTransaction,
  topic: string,
  aggregateType: string,
  aggregateId: string,
  version: number,
  payload: Readonly<Record<string, unknown>>,
  now: Date,
  idempotencyDiscriminator?: string,
): Promise<string> {
  const id = newUuid();
  await transaction
    .insertInto("platform.outbox_event")
    .values({
      id,
      topic,
      aggregate_type: aggregateType,
      aggregate_id: aggregateId,
      payload,
      idempotency_key: `${topic}:${aggregateId}:v${version}${
        idempotencyDiscriminator ? `:${idempotencyDiscriminator}` : ""
      }`,
      occurred_at: now,
      available_at: now,
      attempt_count: 0,
      locked_at: null,
      locked_by: null,
      delivered_at: null,
      last_error_code: null,
    })
    .execute();
  return id;
}

export class PostgresCrmOperationsRepository implements CrmOperationsRepositoryPort {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly idempotencyTtlSeconds = 86_400,
  ) {
    if (!Number.isSafeInteger(idempotencyTtlSeconds) || idempotencyTtlSeconds < 60) {
      throw new Error("CRM operations idempotency TTL must be at least 60 seconds");
    }
  }

  async createCommunicationDraft(
    command: CrmOperationsCreateCommand<CreateCommunicationDraftBody>,
  ): Promise<IdempotentCrmOperationsResult<CommunicationDraft>> {
    const result = await this.db.transaction().execute(async (transaction) => {
      const scope = `crm.communication.create:${command.actor.userAccountId}`;
      const claim = await this.claimIdempotency(
        transaction,
        scope,
        command.idempotencyKey,
        command.requestHash,
      );
      if (claim.replayedResourceId) return { id: claim.replayedResourceId, replayed: true };

      const recipients = sortedUnique(command.input.recipientPersonIds);
      await this.assertRecipientsVisible(transaction, command.access, recipients);
      const now = new Date();
      const id = newUuid();
      const fingerprint = selectionFingerprint(recipients);
      await transaction
        .insertInto("crm.communication_draft")
        .values({
          id,
          public_id: publicId("communication"),
          channel: command.input.channel,
          subject: command.input.subject?.trim() ?? null,
          body: command.input.body.trim(),
          selection: { recipientPersonIds: recipients },
          selection_fingerprint: fingerprint,
          state: "draft",
          created_by_user_account_id: command.actor.userAccountId,
          confirmed_by_user_account_id: null,
          confirmed_at: null,
          queued_at: null,
          created_at: now,
          updated_at: now,
          archived_at: null,
        })
        .execute();
      await this.replaceRecipients(transaction, id, recipients, now);
      await appendAuditEvent(transaction, {
        eventType: "crm.communication.draft.created",
        actorType: "user_account",
        actorId: command.actor.userAccountId,
        subjectType: "crm_communication_draft",
        subjectId: id,
        requestId: command.actor.requestId,
        reason: command.input.reason,
        beforeState: null,
        afterState: {
          state: "draft",
          channel: command.input.channel,
          recipientCount: recipients.length,
          selectionFingerprint: fingerprint,
          externalDeliveryRequested: false,
          version: 1,
        },
        policyVersion: "crm-communication-approval-only@1",
        scopeSnapshot: scopeSnapshot(command.access),
        occurredAt: now,
      });
      await appendOutbox(
        transaction,
        "crm.communication.draft.created.v1",
        "crm_communication_draft",
        id,
        1,
        { draftId: id, recipientCount: recipients.length, externalDeliveryRequested: false },
        now,
      );
      await this.completeIdempotency(transaction, scope, command.idempotencyKey, id);
      return { id, replayed: false };
    });

    const value = await this.readCommunicationDraft(
      this.db,
      result.id,
      command.access,
      command.actor.userAccountId,
    );
    if (!value) {
      if (result.replayed) throw new AppError(404, "not_found", "Черновик коммуникации не найден");
      throw new Error("Created communication draft is not readable after commit");
    }
    return { value, replayed: result.replayed };
  }

  async updateCommunicationDraft(
    command: CrmOperationsUpdateCommand<UpdateCommunicationDraftBody>,
  ): Promise<CrmOperationsMutationResult<CommunicationDraft>> {
    return this.db.transaction().execute(async (transaction) => {
      const current = await this.lockCommunicationDraft(
        transaction,
        command.resourceId,
        command.access,
        command.actor.userAccountId,
      );
      if (!current) return { kind: "not_found" } as const;
      const currentVersion = toNumber(current.version);
      if (currentVersion !== command.expectedVersion) {
        return { kind: "version_conflict", currentVersion } as const;
      }
      if (current.state !== "draft") {
        return { kind: "state_conflict", currentState: current.state, currentVersion } as const;
      }

      const existingRecipients = await this.recipientIds(transaction, current.id);
      const recipients = command.input.recipientPersonIds
        ? sortedUnique(command.input.recipientPersonIds)
        : existingRecipients;
      await this.assertRecipientsVisible(transaction, command.access, recipients);
      const channel = command.input.channel ?? (current.channel as "email" | "max");
      const subject = command.input.subject === undefined ? current.subject : command.input.subject;
      if (channel === "email" && !subject?.trim()) {
        return {
          kind: "guard_failed",
          code: "email_subject_required",
          message: "Для email укажите тему письма",
        } as const;
      }
      if (channel === "max" && subject !== null) {
        return {
          kind: "guard_failed",
          code: "subject_not_supported",
          message: "Канал MAX не использует тему сообщения",
        } as const;
      }

      const now = new Date();
      const fingerprint = selectionFingerprint(recipients);
      const updated = await transaction
        .updateTable("crm.communication_draft")
        .set({
          channel,
          subject: subject?.trim() ?? null,
          body: command.input.body?.trim() ?? current.body,
          selection: { recipientPersonIds: recipients },
          selection_fingerprint: fingerprint,
        })
        .where("id", "=", current.id)
        .where("version", "=", command.expectedVersion)
        .returningAll()
        .executeTakeFirst();
      if (!updated) return { kind: "version_conflict", currentVersion } as const;
      if (command.input.recipientPersonIds) {
        await transaction
          .deleteFrom("crm.communication_recipient")
          .where("draft_id", "=", current.id)
          .execute();
        await this.replaceRecipients(transaction, current.id, recipients, now);
      }
      const version = toNumber(updated.version);
      await appendAuditEvent(transaction, {
        eventType: "crm.communication.draft.updated",
        actorType: "user_account",
        actorId: command.actor.userAccountId,
        subjectType: "crm_communication_draft",
        subjectId: current.id,
        requestId: command.actor.requestId,
        reason: command.input.reason,
        beforeState: {
          state: current.state,
          channel: current.channel,
          recipientCount: existingRecipients.length,
          selectionFingerprint: current.selection_fingerprint,
          version: currentVersion,
        },
        afterState: {
          state: updated.state,
          channel: updated.channel,
          recipientCount: recipients.length,
          selectionFingerprint: updated.selection_fingerprint,
          externalDeliveryRequested: false,
          version,
        },
        policyVersion: "crm-communication-approval-only@1",
        scopeSnapshot: scopeSnapshot(command.access),
        occurredAt: now,
      });
      await appendOutbox(
        transaction,
        "crm.communication.draft.updated.v1",
        "crm_communication_draft",
        current.id,
        version,
        { draftId: current.id, recipientCount: recipients.length, externalDeliveryRequested: false },
        now,
      );
      const value = await this.readCommunicationDraft(
        transaction,
        current.id,
        command.access,
        command.actor.userAccountId,
      );
      if (!value) throw new Error("Updated communication draft is not readable inside transaction");
      return { kind: "succeeded", value } as const;
    });
  }

  async confirmCommunicationDraft(
    command: CrmOperationsUpdateCommand<{
      readonly selectionFingerprint: string;
      readonly reason: string;
    }>,
  ): Promise<CrmOperationsMutationResult<CommunicationDraft>> {
    return this.db.transaction().execute(async (transaction) => {
      const current = await this.lockCommunicationDraft(transaction, command.resourceId, command.access);
      if (!current) return { kind: "not_found" } as const;
      const currentVersion = toNumber(current.version);
      if (currentVersion !== command.expectedVersion) {
        return { kind: "version_conflict", currentVersion } as const;
      }
      if (current.state !== "draft") {
        return { kind: "state_conflict", currentState: current.state, currentVersion } as const;
      }
      if (current.created_by_user_account_id === command.actor.userAccountId) {
        return {
          kind: "guard_failed",
          code: "self_approval_forbidden",
          message: "Создатель черновика не может сам подтвердить коммуникацию",
        } as const;
      }
      if (current.selection_fingerprint !== command.input.selectionFingerprint) {
        return {
          kind: "guard_failed",
          code: "selection_fingerprint_mismatch",
          message: "Состав получателей изменился; повторите проверку черновика",
        } as const;
      }
      const recipients = await this.recipientIds(transaction, current.id);
      await this.assertRecipientsVisible(transaction, command.access, recipients);

      const now = new Date();
      const updated = await transaction
        .updateTable("crm.communication_draft")
        .set({
          state: "confirmed",
          confirmed_by_user_account_id: command.actor.userAccountId,
          confirmed_at: now,
          queued_at: null,
        })
        .where("id", "=", current.id)
        .where("version", "=", command.expectedVersion)
        .where("state", "=", "draft")
        .returningAll()
        .executeTakeFirst();
      if (!updated) return { kind: "version_conflict", currentVersion } as const;
      const version = toNumber(updated.version);
      await appendAuditEvent(transaction, {
        eventType: "crm.communication.approval.recorded",
        actorType: "user_account",
        actorId: command.actor.userAccountId,
        subjectType: "crm_communication_draft",
        subjectId: current.id,
        requestId: command.actor.requestId,
        reason: command.input.reason,
        beforeState: { state: "draft", version: currentVersion },
        afterState: {
          state: "confirmed",
          recipientCount: recipients.length,
          selectionFingerprint: current.selection_fingerprint,
          externalDeliveryRequested: false,
          version,
        },
        policyVersion: "crm-communication-approval-only@1",
        scopeSnapshot: scopeSnapshot(command.access),
        occurredAt: now,
      });
      // Confirmation never implies delivery; QueueCommunication owns the separate durable transition.
      await appendOutbox(
        transaction,
        "crm.communication.approval.recorded.v1",
        "crm_communication_draft",
        current.id,
        version,
        { draftId: current.id, recipientCount: recipients.length, externalDeliveryRequested: false },
        now,
      );
      const value = await this.readCommunicationDraft(transaction, current.id, command.access);
      if (!value) throw new Error("Confirmed communication draft is not readable inside transaction");
      return { kind: "succeeded", value } as const;
    });
  }

  async queueCommunication(
    command: CrmOperationsIdempotentUpdateCommand<QueueCommunicationBody>,
  ): Promise<IdempotentCrmOperationsResult<CommunicationDraft>> {
    const result = await this.db.transaction().execute(async (transaction) => {
      const scope = `crm.communication.queue:${command.actor.userAccountId}`;
      const claim = await this.claimIdempotency(
        transaction,
        scope,
        command.idempotencyKey,
        command.requestHash,
      );
      if (claim.replayedResourceId) return { id: claim.replayedResourceId, replayed: true };

      const current = await this.lockCommunicationDraft(transaction, command.resourceId, command.access);
      if (!current) throw new AppError(404, "not_found", "Коммуникация не найдена");
      const currentVersion = toNumber(current.version);
      if (currentVersion !== command.expectedVersion) {
        throw new AppError(409, "version_conflict", "Коммуникация уже изменена", {
          details: { expectedVersion: command.expectedVersion, currentVersion },
        });
      }
      if (current.state !== "confirmed") {
        throw new AppError(
          409,
          "state_conflict",
          "В очередь можно поставить только подтверждённую коммуникацию",
          {
            details: { currentState: current.state, currentVersion },
          },
        );
      }
      if (
        !current.confirmed_by_user_account_id ||
        current.confirmed_by_user_account_id === current.created_by_user_account_id
      ) {
        throw new AppError(
          409,
          "confirmation_evidence_missing",
          "Коммуникация не содержит корректного подтверждения второго сотрудника",
        );
      }
      if (current.selection_fingerprint !== command.input.selectionFingerprint) {
        throw new AppError(
          422,
          "selection_fingerprint_mismatch",
          "Состав получателей изменился; повторите проверку коммуникации",
        );
      }

      const recipients = await this.recipientIds(transaction, current.id);
      await this.assertRecipientsVisible(transaction, command.access, recipients);
      const now = new Date();
      const updated = await transaction
        .updateTable("crm.communication_draft")
        .set({ state: "queued", queued_at: now })
        .where("id", "=", current.id)
        .where("version", "=", command.expectedVersion)
        .where("state", "=", "confirmed")
        .returningAll()
        .executeTakeFirst();
      if (!updated) {
        throw new AppError(409, "version_conflict", "Коммуникация уже изменена", {
          details: { expectedVersion: command.expectedVersion, currentVersion },
        });
      }
      const version = toNumber(updated.version);
      const queuedEventId = await appendOutbox(
        transaction,
        "crm.communication.queued.v1",
        "crm_communication_draft",
        current.id,
        version,
        {
          draftId: current.id,
          channel: current.channel,
          recipientCount: recipients.length,
          selectionFingerprint: current.selection_fingerprint,
          deliveryBoundary: "durable_outbox_only",
          externalProviderConfigured: false,
        },
        now,
      );
      const recipientUpdate = await transaction
        .updateTable("crm.communication_recipient")
        .set({ state: "queued", queued_event_id: queuedEventId, updated_at: now })
        .where("draft_id", "=", current.id)
        .where("state", "=", "selected")
        .executeTakeFirst();
      if (Number(recipientUpdate.numUpdatedRows) !== recipients.length) {
        throw new Error("Communication recipient queue transition was not atomic");
      }
      await appendAuditEvent(transaction, {
        eventType: "crm.communication.queued",
        actorType: "user_account",
        actorId: command.actor.userAccountId,
        subjectType: "crm_communication_draft",
        subjectId: current.id,
        requestId: command.actor.requestId,
        reason: command.input.reason,
        beforeState: { state: "confirmed", version: currentVersion },
        afterState: {
          state: "queued",
          recipientCount: recipients.length,
          selectionFingerprint: current.selection_fingerprint,
          deliveryBoundary: "durable_outbox_only",
          externalProviderConfigured: false,
          version,
        },
        policyVersion: "crm-communication-durable-queue@1",
        scopeSnapshot: scopeSnapshot(command.access),
        occurredAt: now,
      });
      await this.completeIdempotency(transaction, scope, command.idempotencyKey, current.id, 200);
      return { id: current.id, replayed: false };
    });

    const value = await this.readCommunicationDraft(this.db, result.id, command.access);
    if (!value) {
      if (result.replayed) throw new AppError(404, "not_found", "Коммуникация не найдена");
      throw new Error("Queued communication is not readable after commit");
    }
    return { value, replayed: result.replayed };
  }

  async getDashboardSummary(
    context: CrmOperationsContext,
    query: { readonly timezone?: string },
  ): Promise<DashboardSummary> {
    const caseScope = caseScopeSql(context.access, "case_row");
    const taskScope = taskScopeSql(context.access, "task_row");
    const referralScope = referralScopeSql(context.access, "referral");
    const result = await sql<{
      open_case_count: number | string;
      overdue_task_count: number | string;
      pending_referral_count: number | string;
      unread_notification_count: number | string;
      own_draft_communication_count: number | string;
      data_fresh_at: Date | string;
    }>`
      select
        (select count(*) from crm."case" case_row
          where case_row.archived_at is null
            and case_row.status not in ('completed', 'cancelled', 'archived')
            and ${caseScope}) as open_case_count,
        (select count(*) from crm.task task_row
          where task_row.archived_at is null
            and task_row.state not in ('completed', 'cancelled')
            and task_row.due_at < clock_timestamp()
            and ${taskScope}) as overdue_task_count,
        (select count(*) from crm.employer_referral referral
          where referral.archived_at is null
            and referral.stage_code not in ('accepted', 'rejected_by_employer', 'rejected_by_candidate', 'cancelled')
            and ${referralScope}) as pending_referral_count,
        (select count(*) from crm.notification notification
          where notification.recipient_user_account_id = ${context.actor.userAccountId}::uuid
            and notification.read_at is null) as unread_notification_count,
        (select count(*) from crm.communication_draft communication
          where communication.created_by_user_account_id = ${context.actor.userAccountId}::uuid
            and communication.archived_at is null
            and communication.state = 'draft') as own_draft_communication_count,
        clock_timestamp() as data_fresh_at
    `.execute(this.db);
    const row = result.rows[0];
    if (!row) throw new Error("Dashboard query returned no row");
    return {
      openCaseCount: toNumber(row.open_case_count),
      overdueTaskCount: toNumber(row.overdue_task_count),
      pendingReferralCount: toNumber(row.pending_referral_count),
      unreadNotificationCount: toNumber(row.unread_notification_count),
      ownDraftCommunicationCount: toNumber(row.own_draft_communication_count),
      scopeVisibility: context.access.visibility,
      timezone: query.timezone ?? "Europe/Moscow",
      dataFreshAt: toIso(row.data_fresh_at),
    };
  }

  async listNotifications(
    context: CrmOperationsContext,
    query: NotificationRepositoryQuery,
  ): Promise<CrmOperationsRepositoryPage<Notification>> {
    const unreadFilter = query.unreadOnly ? sql`and notification.read_at is null` : sql``;
    const typeFilter = query.typeCode ? sql`and notification.type_code = ${query.typeCode}` : sql``;
    const cursorFilter = query.cursor
      ? sql`and (notification.occurred_at, notification.id) < (${new Date(
          query.cursor.createdAt,
        )}, ${query.cursor.id}::uuid)`
      : sql``;
    const result = await sql<NotificationRow>`
      select notification.*
      from crm.notification notification
      where notification.recipient_user_account_id = ${context.actor.userAccountId}::uuid
        ${unreadFilter}
        ${typeFilter}
        ${cursorFilter}
      order by notification.occurred_at desc, notification.id desc
      limit ${query.limit + 1}
    `.execute(this.db);
    const hasMore = result.rows.length > query.limit;
    const rows = result.rows.slice(0, query.limit);
    const last = rows.at(-1);
    return {
      items: rows.map(mapNotification),
      nextCursor: hasMore && last ? { createdAt: toIso(last.occurred_at), id: last.id } : null,
      hasMore,
    };
  }

  async markNotificationRead(
    command: Omit<CrmOperationsUpdateCommand<Record<string, never>>, "input">,
  ): Promise<CrmOperationsMutationResult<Notification>> {
    return this.db.transaction().execute(async (transaction) => {
      const result = await sql<NotificationRow>`
        select notification.*
        from crm.notification notification
        where (notification.id::text = ${command.resourceId} or notification.public_id = ${command.resourceId})
          and notification.recipient_user_account_id = ${command.actor.userAccountId}::uuid
        for update
      `.execute(transaction);
      const current = result.rows[0];
      if (!current) return { kind: "not_found" } as const;
      const currentVersion = current.read_at === null ? 1 : 2;
      if (currentVersion !== command.expectedVersion) {
        return { kind: "version_conflict", currentVersion } as const;
      }
      if (current.read_at !== null) return { kind: "succeeded", value: mapNotification(current) } as const;

      const now = new Date();
      await transaction
        .updateTable("crm.notification")
        .set({ read_at: now })
        .where("id", "=", current.id)
        .where("read_at", "is", null)
        .executeTakeFirstOrThrow();
      await appendAuditEvent(transaction, {
        eventType: "crm.notification.read",
        actorType: "user_account",
        actorId: command.actor.userAccountId,
        subjectType: "crm_notification",
        subjectId: current.id,
        requestId: command.actor.requestId,
        reason: "user_marked_read",
        beforeState: { read: false, version: 1 },
        afterState: { read: true, version: 2 },
        policyVersion: "crm-notification-owner-only@1",
        scopeSnapshot: { visibility: "owner" },
        occurredAt: now,
      });
      await appendOutbox(
        transaction,
        "crm.notification.read.v1",
        "crm_notification",
        current.id,
        2,
        { notificationId: current.id, recipientUserAccountId: command.actor.userAccountId },
        now,
      );
      return {
        kind: "succeeded",
        value: mapNotification({ ...current, read_at: now }),
      } as const;
    });
  }

  async runReport(command: RunReportCommand): Promise<IdempotentCrmOperationsResult<ReportRun>> {
    const result = await this.db.transaction().execute(async (transaction) => {
      const scope = `crm.report.run:${command.actor.userAccountId}`;
      const claim = await this.claimIdempotency(
        transaction,
        scope,
        command.idempotencyKey,
        command.requestHash,
      );
      if (claim.replayedResourceId) return { id: claim.replayedResourceId, replayed: true };
      const now = new Date();
      const reportResult = await this.buildReport(transaction, command.input, command.access);
      const id = newUuid();
      await transaction
        .insertInto("crm.report_run")
        .values({
          id,
          public_id: publicId("report"),
          report_code: command.input.reportCode,
          formula_version: command.formulaVersion,
          timezone: command.input.timezone,
          filters: command.input.filters ?? {},
          scope_snapshot: scopeSnapshot(command.access),
          state: "completed",
          result: reportResult,
          excluded_records: 0,
          data_fresh_at: now,
          created_by_user_account_id: command.actor.userAccountId,
          created_at: now,
        })
        .execute();
      await appendAuditEvent(transaction, {
        eventType: "crm.report.completed",
        actorType: "user_account",
        actorId: command.actor.userAccountId,
        subjectType: "crm_report_run",
        subjectId: id,
        requestId: command.actor.requestId,
        reason: command.input.reason,
        beforeState: null,
        afterState: {
          reportCode: command.input.reportCode,
          formulaVersion: command.formulaVersion,
          state: "completed",
          excludedRecords: 0,
        },
        policyVersion: "crm-reports-scope-bound@1",
        scopeSnapshot: scopeSnapshot(command.access),
        occurredAt: now,
      });
      await appendOutbox(
        transaction,
        "crm.report.completed.v1",
        "crm_report_run",
        id,
        1,
        { reportRunId: id, reportCode: command.input.reportCode, formulaVersion: command.formulaVersion },
        now,
      );
      await this.completeIdempotency(transaction, scope, command.idempotencyKey, id);
      return { id, replayed: false };
    });
    const value = await this.getReportRun({ actor: command.actor, access: command.access }, result.id);
    if (!value) throw new Error("Created report run is not readable after commit");
    return { value, replayed: result.replayed };
  }

  async listReportRuns(
    context: CrmOperationsContext,
    query: ReportRunRepositoryQuery,
  ): Promise<CrmOperationsRepositoryPage<ReportRun>> {
    const reportFilter = query.reportCode ? sql`and report.report_code = ${query.reportCode}` : sql``;
    const stateFilter = query.state ? sql`and report.state = ${query.state}` : sql``;
    const cursorFilter = query.cursor
      ? sql`and (report.created_at, report.id) < (${new Date(
          query.cursor.createdAt,
        )}, ${query.cursor.id}::uuid)`
      : sql``;
    const result = await sql<ReportRunRow>`
      select report.*
      from crm.report_run report
      where report.created_by_user_account_id = ${context.actor.userAccountId}::uuid
        ${reportFilter}
        ${stateFilter}
        ${cursorFilter}
      order by report.created_at desc, report.id desc
      limit ${query.limit + 1}
    `.execute(this.db);
    const hasMore = result.rows.length > query.limit;
    const rows = result.rows.slice(0, query.limit);
    const last = rows.at(-1);
    return {
      items: rows.map(mapReportRun),
      nextCursor: hasMore && last ? { createdAt: toIso(last.created_at), id: last.id } : null,
      hasMore,
    };
  }

  async getReportRun(context: CrmOperationsContext, reportRunId: string): Promise<ReportRun | null> {
    const result = await sql<ReportRunRow>`
      select report.*
      from crm.report_run report
      where (report.id::text = ${reportRunId} or report.public_id = ${reportRunId})
        and report.created_by_user_account_id = ${context.actor.userAccountId}::uuid
      limit 1
    `.execute(this.db);
    return result.rows[0] ? mapReportRun(result.rows[0]) : null;
  }

  async recordReportExport(command: RecordReportExportCommand): Promise<{ readonly replayed: boolean }> {
    return this.db.transaction().execute(async (transaction) => {
      const scope = `crm.report.export:${command.actor.userAccountId}`;
      const claim = await this.claimIdempotency(
        transaction,
        scope,
        command.idempotencyKey,
        command.requestHash,
      );
      if (claim.replayedResourceId) {
        if (claim.replayedResourceId !== command.reportRunId) {
          throw new AppError(409, "idempotency_conflict", "Idempotency-Key связан с другим отчётом");
        }
        return { replayed: true };
      }
      const report = await transaction
        .selectFrom("crm.report_run")
        .select(["id", "report_code", "formula_version"])
        .where("id", "=", command.reportRunId)
        .where("created_by_user_account_id", "=", command.actor.userAccountId)
        .executeTakeFirst();
      if (!report) throw new AppError(404, "not_found", "Запуск отчёта не найден");
      if (report.report_code !== command.reportCode || report.formula_version !== command.formulaVersion) {
        throw new AppError(409, "report_manifest_changed", "Метаданные сохранённого отчёта изменились");
      }
      const now = new Date();
      await appendAuditEvent(transaction, {
        eventType: "crm.report.exported",
        actorType: "user_account",
        actorId: command.actor.userAccountId,
        subjectType: "crm_report_run",
        subjectId: command.reportRunId,
        requestId: command.actor.requestId,
        reason: "bounded_aggregate_csv_export",
        beforeState: null,
        afterState: {
          reportCode: command.reportCode,
          formulaVersion: command.formulaVersion,
          format: "csv",
          sha256: command.sha256,
          byteSize: command.byteSize,
        },
        policyVersion: "crm-report-export-bounded@1",
        scopeSnapshot: scopeSnapshot(command.access),
        occurredAt: now,
      });
      await appendOutbox(
        transaction,
        "crm.report.exported.v1",
        "crm_report_run",
        command.reportRunId,
        1,
        {
          reportRunId: command.reportRunId,
          reportCode: command.reportCode,
          formulaVersion: command.formulaVersion,
          format: "csv",
          sha256: command.sha256,
          byteSize: command.byteSize,
        },
        now,
        createHash("sha256").update(command.idempotencyKey).digest("hex").slice(0, 16),
      );
      await this.completeIdempotency(transaction, scope, command.idempotencyKey, command.reportRunId);
      return { replayed: false };
    });
  }

  async getSetting(
    _context: CrmOperationsContext,
    settingCode: CrmSettingCode,
  ): Promise<SettingVersion | null> {
    const row = await this.db
      .selectFrom("crm.setting_version")
      .selectAll()
      .where("setting_code", "=", settingCode)
      .orderBy("version", "desc")
      .limit(1)
      .executeTakeFirst();
    return row ? mapSetting(row) : null;
  }

  async updateSetting(command: UpdateSettingCommand): Promise<CrmOperationsMutationResult<SettingVersion>> {
    return this.db.transaction().execute(async (transaction) => {
      await sql`select pg_advisory_xact_lock(hashtextextended(${command.settingCode}, 0))`.execute(
        transaction,
      );
      const current = await transaction
        .selectFrom("crm.setting_version")
        .selectAll()
        .where("setting_code", "=", command.settingCode)
        .orderBy("version", "desc")
        .limit(1)
        .executeTakeFirst();
      const currentVersion = current ? toNumber(current.version) : 0;
      if (currentVersion !== command.expectedVersion) {
        return { kind: "version_conflict", currentVersion } as const;
      }
      const now = new Date();
      const nextVersion = currentVersion + 1;
      if (command.input.activate ?? false) {
        await transaction
          .updateTable("crm.setting_version")
          .set({ state: "retired" })
          .where("setting_code", "=", command.settingCode)
          .where("state", "=", "active")
          .execute();
      }
      const inserted = await transaction
        .insertInto("crm.setting_version")
        .values({
          id: newUuid(),
          setting_code: command.settingCode,
          version: nextVersion,
          config: command.input.config,
          state: (command.input.activate ?? false) ? "active" : "draft",
          reason: command.input.reason,
          created_by_user_account_id: command.actor.userAccountId,
          activated_at: (command.input.activate ?? false) ? now : null,
          created_at: now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await appendAuditEvent(transaction, {
        eventType: "crm.setting.version.created",
        actorType: "user_account",
        actorId: command.actor.userAccountId,
        subjectType: "crm_setting",
        subjectId: inserted.id,
        requestId: command.actor.requestId,
        reason: command.input.reason,
        beforeState: current
          ? { settingCode: command.settingCode, version: currentVersion, state: current.state }
          : null,
        afterState: {
          settingCode: command.settingCode,
          schemaVersion: command.schemaVersion,
          version: nextVersion,
          state: inserted.state,
        },
        policyVersion: "crm-settings-versioned@1",
        scopeSnapshot: scopeSnapshot(command.access),
        occurredAt: now,
      });
      await appendOutbox(
        transaction,
        "crm.setting.version.created.v1",
        "crm_setting",
        inserted.id,
        nextVersion,
        {
          settingId: inserted.id,
          settingCode: command.settingCode,
          schemaVersion: command.schemaVersion,
          state: inserted.state,
        },
        now,
      );
      return { kind: "succeeded", value: mapSetting(inserted) } as const;
    });
  }

  private async lockCommunicationDraft(
    transaction: CrmTransaction,
    draftId: string,
    access: CrmAccessScope,
    creatorUserAccountId?: string,
  ): Promise<CommunicationDraftRow | null> {
    const creatorFilter = creatorUserAccountId
      ? sql`and communication.created_by_user_account_id = ${creatorUserAccountId}::uuid`
      : sql``;
    const accessFilter = communicationRecipientScopeSql(access);
    const result = await sql<CommunicationDraftRow>`
      select communication.*
      from crm.communication_draft communication
      where (communication.id::text = ${draftId} or communication.public_id = ${draftId})
        and communication.archived_at is null
        ${creatorFilter}
        and ${accessFilter}
      for update
    `.execute(transaction);
    return result.rows[0] ?? null;
  }

  private async readCommunicationDraft(
    executor: CrmExecutor,
    draftId: string,
    access: CrmAccessScope,
    creatorUserAccountId?: string,
  ): Promise<CommunicationDraft | null> {
    const creatorFilter = creatorUserAccountId
      ? sql`and communication.created_by_user_account_id = ${creatorUserAccountId}::uuid`
      : sql``;
    const accessFilter = communicationRecipientScopeSql(access);
    const result = await sql<CommunicationDraftWithRecipientsRow>`
      select
        communication.*,
        array_agg(recipient.person_id order by recipient.person_id) as recipient_person_ids
      from crm.communication_draft communication
      join crm.communication_recipient recipient on recipient.draft_id = communication.id
      where (communication.id::text = ${draftId} or communication.public_id = ${draftId})
        and communication.archived_at is null
        ${creatorFilter}
        and ${accessFilter}
      group by communication.id
      limit 1
    `.execute(executor);
    const row = result.rows[0];
    if (!row) return null;
    const recipients = row.recipient_person_ids;
    const queuedAt = nullableIso(row.queued_at);
    return {
      id: row.id,
      publicId: row.public_id,
      channel: row.channel as CommunicationDraft["channel"],
      subject: row.subject,
      body: row.body,
      recipientPersonIds: recipients,
      recipientCount: recipients.length,
      selectionFingerprint: row.selection_fingerprint,
      state: row.state as CommunicationDraft["state"],
      deliveryBoundary: queuedAt ? "durable_outbox_only" : "approval_only",
      externalDeliveryState: queuedAt ? "queued_internal" : "not_requested",
      createdByUserAccountId: row.created_by_user_account_id,
      confirmedByUserAccountId: row.confirmed_by_user_account_id,
      confirmedAt: nullableIso(row.confirmed_at),
      queuedAt,
      version: toNumber(row.version),
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    };
  }

  private async recipientIds(executor: CrmExecutor, draftId: string): Promise<string[]> {
    const rows = await executor
      .selectFrom("crm.communication_recipient")
      .select("person_id")
      .where("draft_id", "=", draftId)
      .orderBy("person_id")
      .execute();
    return rows.map((row) => row.person_id);
  }

  private async assertRecipientsVisible(
    executor: CrmExecutor,
    access: CrmAccessScope,
    recipientIds: readonly string[],
  ): Promise<void> {
    if (recipientIds.length === 0) {
      throw new AppError(422, "recipient_required", "Добавьте хотя бы одного получателя");
    }
    const personScope = crmOperationsPersonScopeSql(access, "person_row");
    const result = await sql<{ id: string }>`
      select person_row.id
      from identity.person person_row
      where person_row.id in (${uuidValues(recipientIds)})
        and person_row.archived_at is null
        and ${personScope}
    `.execute(executor);
    if (result.rows.length !== recipientIds.length) {
      throw new AppError(
        403,
        "recipient_out_of_scope",
        "Один или несколько получателей недоступны в области пользователя",
      );
    }
  }

  private async replaceRecipients(
    transaction: CrmTransaction,
    draftId: string,
    recipientIds: readonly string[],
    now: Date,
  ): Promise<void> {
    await transaction
      .insertInto("crm.communication_recipient")
      .values(
        recipientIds.map((personId) => ({
          id: newUuid(),
          draft_id: draftId,
          person_id: personId,
          state: "selected",
          attempt_count: 0,
          last_error_code: null,
          queued_event_id: null,
          created_at: now,
          updated_at: now,
        })),
      )
      .execute();
  }

  private async buildReport(
    executor: CrmExecutor,
    input: RunReportBody,
    access: CrmAccessScope,
  ): Promise<Record<string, unknown>> {
    switch (input.reportCode) {
      case "pipeline.summary": {
        const scope = caseScopeSql(access, "case_row");
        const funnelFilter = input.filters?.funnelCode
          ? sql`and case_row.funnel_code = ${input.filters.funnelCode}`
          : sql``;
        const statusFilter = input.filters?.status
          ? sql`and case_row.status = ${input.filters.status}`
          : sql``;
        const result = await sql<{
          stage_code: string;
          status: string;
          record_count: number | string;
        }>`
          select case_row.stage_code, case_row.status, count(*) as record_count
          from crm."case" case_row
          where case_row.archived_at is null
            and ${scope}
            ${funnelFilter}
            ${statusFilter}
          group by case_row.stage_code, case_row.status
          order by case_row.stage_code, case_row.status
        `.execute(executor);
        const dimensions = result.rows.map((row) => ({
          stageCode: row.stage_code,
          status: row.status,
          count: toNumber(row.record_count),
        }));
        return {
          dimensions,
          total: dimensions.reduce((sum, row) => sum + row.count, 0),
        };
      }
      case "workload.summary": {
        const scope = taskScopeSql(access, "task_row");
        const stateFilter = input.filters?.state ? sql`and task_row.state = ${input.filters.state}` : sql``;
        const dueFilter = input.filters?.dueBefore
          ? sql`and task_row.due_at <= ${new Date(input.filters.dueBefore)}`
          : sql``;
        const result = await sql<{
          state: string;
          record_count: number | string;
          overdue_count: number | string;
        }>`
          select
            task_row.state,
            count(*) as record_count,
            count(*) filter (
              where task_row.due_at < clock_timestamp()
                and task_row.state not in ('completed', 'cancelled')
            ) as overdue_count
          from crm.task task_row
          where task_row.archived_at is null
            and ${scope}
            ${stateFilter}
            ${dueFilter}
          group by task_row.state
          order by task_row.state
        `.execute(executor);
        const dimensions = result.rows.map((row) => ({
          state: row.state,
          count: toNumber(row.record_count),
          overdueCount: toNumber(row.overdue_count),
        }));
        return {
          dimensions,
          total: dimensions.reduce((sum, row) => sum + row.count, 0),
          overdueTotal: dimensions.reduce((sum, row) => sum + row.overdueCount, 0),
        };
      }
      case "referrals.outcomes": {
        const scope = referralScopeSql(access, "referral");
        const stageFilter = input.filters?.stageCode
          ? sql`and referral.stage_code = ${input.filters.stageCode}`
          : sql``;
        const result = await sql<{ stage_code: string; record_count: number | string }>`
          select referral.stage_code, count(*) as record_count
          from crm.employer_referral referral
          where referral.archived_at is null
            and ${scope}
            ${stageFilter}
          group by referral.stage_code
          order by referral.stage_code
        `.execute(executor);
        const dimensions = result.rows.map((row) => ({
          stageCode: row.stage_code,
          count: toNumber(row.record_count),
        }));
        return {
          dimensions,
          total: dimensions.reduce((sum, row) => sum + row.count, 0),
        };
      }
      case "applications.sources": {
        const scope = crmOperationsPersonScopeSql(access, "person_row");
        const sourceFilter = input.filters?.sourceCode
          ? sql`and candidate_source.source_code = ${input.filters.sourceCode}`
          : sql``;
        const entryPointFilter = input.filters?.entryPointCode
          ? sql`and candidate_source.entry_point_code = ${input.filters.entryPointCode}`
          : sql``;
        const result = await sql<{
          source_code: string;
          entry_point_code: string | null;
          record_count: number | string;
        }>`
          select candidate_source.source_code, candidate_source.entry_point_code, count(*) as record_count
          from crm.candidate_source candidate_source
          join crm.profile profile on profile.id = candidate_source.crm_profile_id
          join identity.person person_row on person_row.id = profile.person_id
          where candidate_source.archived_at is null
            and profile.archived_at is null
            and person_row.archived_at is null
            and ${scope}
            ${sourceFilter}
            ${entryPointFilter}
          group by candidate_source.source_code, candidate_source.entry_point_code
          order by candidate_source.source_code, candidate_source.entry_point_code nulls first
        `.execute(executor);
        const dimensions = result.rows.map((row) => ({
          sourceCode: row.source_code,
          entryPointCode: row.entry_point_code,
          count: toNumber(row.record_count),
        }));
        return {
          dimensions,
          total: dimensions.reduce((sum, row) => sum + row.count, 0),
        };
      }
      case "employers.activity": {
        const scope = employerScopeSql(access, "employer");
        const statusFilter = input.filters?.status
          ? sql`and employer.status = ${input.filters.status}`
          : sql``;
        const result = await sql<{
          status: string;
          employer_count: number | string;
          referral_count: number | string;
        }>`
          select
            employer.status,
            count(distinct employer.id) as employer_count,
            count(distinct referral.id) as referral_count
          from crm.employer employer
          left join crm.employer_referral referral
            on referral.employer_id = employer.id and referral.archived_at is null
          where employer.archived_at is null
            and ${scope}
            ${statusFilter}
          group by employer.status
          order by employer.status
        `.execute(executor);
        const dimensions = result.rows.map((row) => ({
          status: row.status,
          employerCount: toNumber(row.employer_count),
          referralCount: toNumber(row.referral_count),
        }));
        return {
          dimensions,
          employerTotal: dimensions.reduce((sum, row) => sum + row.employerCount, 0),
          referralTotal: dimensions.reduce((sum, row) => sum + row.referralCount, 0),
        };
      }
      case "relocation.results": {
        const scope = caseScopeSql(access, "case_row");
        const resultFilter = input.filters?.resultCode
          ? sql`and relocation.result_code = ${input.filters.resultCode}`
          : sql``;
        const municipalityFilter = input.filters?.municipality
          ? sql`and relocation.municipality = ${input.filters.municipality}`
          : sql``;
        const result = await sql<{
          result_code: string | null;
          offer_status: string | null;
          employment_status: string | null;
          record_count: number | string;
        }>`
          select
            relocation.result_code,
            relocation.offer_status,
            relocation.employment_status,
            count(*) as record_count
          from crm.relocation_profile relocation
          join crm."case" case_row on case_row.id = relocation.case_id
          where relocation.archived_at is null
            and case_row.archived_at is null
            and ${scope}
            ${resultFilter}
            ${municipalityFilter}
          group by relocation.result_code, relocation.offer_status, relocation.employment_status
          order by relocation.result_code nulls first, relocation.offer_status nulls first,
            relocation.employment_status nulls first
        `.execute(executor);
        const dimensions = result.rows.map((row) => ({
          resultCode: row.result_code,
          offerStatus: row.offer_status,
          employmentStatus: row.employment_status,
          count: toNumber(row.record_count),
        }));
        return {
          dimensions,
          total: dimensions.reduce((sum, row) => sum + row.count, 0),
        };
      }
      case "data_quality.summary": {
        const scope = crmOperationsPersonScopeSql(access, "person_row");
        const profileFilter = input.filters?.profileState
          ? sql`and profile.profile_state = ${input.filters.profileState}`
          : sql``;
        const qualityFilter = input.filters?.dataQualityState
          ? sql`and profile.data_quality_state = ${input.filters.dataQualityState}`
          : sql``;
        const result = await sql<{
          profile_state: string;
          data_quality_state: string;
          record_count: number | string;
        }>`
          select profile.profile_state, profile.data_quality_state, count(*) as record_count
          from crm.profile profile
          join identity.person person_row on person_row.id = profile.person_id
          where profile.archived_at is null
            and person_row.archived_at is null
            and ${scope}
            ${profileFilter}
            ${qualityFilter}
          group by profile.profile_state, profile.data_quality_state
          order by profile.profile_state, profile.data_quality_state
        `.execute(executor);
        const dimensions = result.rows.map((row) => ({
          profileState: row.profile_state,
          dataQualityState: row.data_quality_state,
          count: toNumber(row.record_count),
        }));
        return {
          dimensions,
          total: dimensions.reduce((sum, row) => sum + row.count, 0),
        };
      }
    }
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
    responseStatus = 201,
  ): Promise<void> {
    const result = await transaction
      .updateTable("platform.idempotency_record")
      .set({
        state: "completed",
        response_status: responseStatus,
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
}
