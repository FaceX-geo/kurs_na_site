import { describe, expect, it, vi } from "vitest";
import type { CrmAccessScope, CrmActorContext, CrmAuthorizationPort } from "../src/modules/crm/ports.js";
import type {
  CrmOperationsRepositoryPort,
  CrmOperationsServicePort,
} from "../src/modules/crm-operations/ports.js";
import { CRM_REPORT_DEFINITIONS } from "../src/modules/crm-operations/registry.js";
import { createCrmOperationsService } from "../src/modules/crm-operations/service.js";

const actor: CrmActorContext = {
  userAccountId: "10000000-0000-4000-8000-000000000001",
  employeeProfileId: "20000000-0000-4000-8000-000000000001",
  requestId: "request-1",
};
const assignedAccess: CrmAccessScope = {
  visibility: "assigned",
  actorUserAccountId: actor.userAccountId,
  actorEmployeeProfileId: actor.employeeProfileId,
  employeeProfileIds: [actor.employeeProfileId ?? ""],
  teamIds: [],
  organizationUnitIds: [],
  fieldMask: [],
};
const signingKey = "crm-operations-signing-key-is-long-enough";
const hashingKey = "crm-operations-hashing-key-is-long-enough";

function fixture(
  repository: Partial<CrmOperationsRepositoryPort>,
  access: CrmAccessScope = assignedAccess,
): { service: CrmOperationsServicePort; authorize: ReturnType<typeof vi.fn> } {
  const authorize = vi.fn(async () => access);
  const authorization: CrmAuthorizationPort = { authorize };
  return {
    service: createCrmOperationsService({
      repository: repository as CrmOperationsRepositoryPort,
      authorization,
      cursorSigningKey: signingKey,
      requestHashingKey: hashingKey,
    }),
    authorize,
  };
}

describe("CRM operations service", () => {
  it("registers all seven CRM-12 report groups with versioned formulas", () => {
    expect(Object.keys(CRM_REPORT_DEFINITIONS)).toHaveLength(7);
    expect(Object.values(CRM_REPORT_DEFINITIONS).every((item) => item.formulaVersion.includes("@"))).toBe(
      true,
    );
  });

  it("rejects an email draft without a subject before authorization or persistence", async () => {
    const createCommunicationDraft = vi.fn();
    const { service, authorize } = fixture({ createCommunicationDraft });

    await expect(
      service.createCommunicationDraft(actor, "draft-key-0001", {
        channel: "email",
        body: "Добрый день",
        recipientPersonIds: ["30000000-0000-4000-8000-000000000001"],
        reason: "Подготовка согласованной рассылки",
      }),
    ).rejects.toMatchObject({ statusCode: 422, code: "email_subject_required" });
    expect(authorize).not.toHaveBeenCalled();
    expect(createCommunicationDraft).not.toHaveBeenCalled();
  });

  it("surfaces the four-eyes self-approval boundary as a deterministic error", async () => {
    const confirmCommunicationDraft = vi.fn(async () => ({
      kind: "guard_failed" as const,
      code: "self_approval_forbidden",
      message: "Создатель черновика не может сам подтвердить коммуникацию",
    }));
    const { service, authorize } = fixture({ confirmCommunicationDraft });

    await expect(
      service.confirmCommunicationDraft(actor, "communication-1", 3, {
        selectionFingerprint: "a".repeat(64),
        reason: "Проверен состав получателей",
      }),
    ).rejects.toMatchObject({ statusCode: 422, code: "self_approval_forbidden" });
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: expect.objectContaining({ operationId: "ConfirmCommunicationDraft" }),
        permissionCode: "crm.communication.confirm",
      }),
    );
    expect(confirmCommunicationDraft).toHaveBeenCalledWith(
      expect.objectContaining({ expectedVersion: 3, actor, access: assignedAccess }),
    );
  });

  it("binds a queue retry to draft, version, fingerprint and reason", async () => {
    const queueCommunication = vi.fn(
      async (_command: Parameters<CrmOperationsRepositoryPort["queueCommunication"]>[0]) => ({
        replayed: false,
        value: {
          id: "30000000-0000-4000-8000-000000000001",
          publicId: "communication_1",
          channel: "email" as const,
          subject: "Важная информация",
          body: "Текст",
          recipientPersonIds: ["40000000-0000-4000-8000-000000000001"],
          recipientCount: 1,
          selectionFingerprint: "a".repeat(64),
          state: "queued" as const,
          deliveryBoundary: "durable_outbox_only" as const,
          externalDeliveryState: "queued_internal" as const,
          createdByUserAccountId: "10000000-0000-4000-8000-000000000002",
          confirmedByUserAccountId: actor.userAccountId,
          confirmedAt: "2026-08-06T10:00:00.000Z",
          queuedAt: "2026-08-06T10:01:00.000Z",
          version: 5,
          createdAt: "2026-08-06T09:00:00.000Z",
          updatedAt: "2026-08-06T10:01:00.000Z",
        },
      }),
    );
    const { service, authorize } = fixture({ queueCommunication });
    const body = {
      selectionFingerprint: "a".repeat(64),
      reason: "Подтверждённая коммуникация готова к очереди",
    };

    await service.queueCommunication(actor, "communication-1", 4, "queue-key-0001", body);
    await service.queueCommunication(actor, "communication-1", 4, "queue-key-0001", {
      reason: body.reason,
      selectionFingerprint: body.selectionFingerprint,
    });
    await service.queueCommunication(actor, "communication-2", 4, "queue-key-0001", body);
    await service.queueCommunication(actor, "communication-1", 5, "queue-key-0001", body);
    await service.queueCommunication(actor, "communication-1", 4, "queue-key-0001", {
      ...body,
      selectionFingerprint: "b".repeat(64),
    });
    await service.queueCommunication(actor, "communication-1", 4, "queue-key-0001", {
      ...body,
      reason: "Другая содержательная причина постановки",
    });

    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: expect.objectContaining({ operationId: "QueueCommunication" }),
        permissionCode: "crm.communication.send",
      }),
    );
    expect(queueCommunication).toHaveBeenCalledWith(
      expect.objectContaining({
        actor,
        access: assignedAccess,
        resourceId: "communication-1",
        expectedVersion: 4,
        idempotencyKey: "queue-key-0001",
        input: body,
        requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    const hashes = queueCommunication.mock.calls.map(([command]) => command.requestHash);
    expect(hashes[0]).toBe(hashes[1]);
    expect(new Set([hashes[0], hashes[2], hashes[3], hashes[4], hashes[5]])).toHaveLength(5);
  });

  it("binds notification cursors to actor and filters", async () => {
    const listNotifications = vi
      .fn()
      .mockResolvedValueOnce({
        items: [],
        nextCursor: {
          createdAt: "2026-08-06T10:00:00.000Z",
          id: "30000000-0000-4000-8000-000000000001",
        },
        hasMore: true,
      })
      .mockResolvedValueOnce({ items: [], nextCursor: null, hasMore: false });
    const { service } = fixture({ listNotifications });

    const first = await service.listNotifications(actor, { unreadOnly: true, limit: 10 });
    const cursor = first.page.nextCursor;
    if (!cursor) throw new Error("Expected signed cursor");
    await service.listNotifications(actor, { unreadOnly: true, limit: 10, cursor });
    expect(listNotifications).toHaveBeenNthCalledWith(
      2,
      { actor, access: assignedAccess },
      {
        unreadOnly: true,
        cursor: {
          createdAt: "2026-08-06T10:00:00.000Z",
          id: "30000000-0000-4000-8000-000000000001",
        },
        limit: 10,
      },
    );

    await expect(
      service.listNotifications(actor, { unreadOnly: false, limit: 10, cursor }),
    ).rejects.toMatchObject({ statusCode: 422, code: "invalid_cursor" });
  });

  it("selects a versioned formula and stable request hash for a report run", async () => {
    const runReport = vi.fn(async (_command: Parameters<CrmOperationsRepositoryPort["runReport"]>[0]) => ({
      replayed: false,
      value: {
        id: "40000000-0000-4000-8000-000000000001",
        publicId: "report_1",
        reportCode: "pipeline.summary" as const,
        formulaVersion: "pipeline.summary@1",
        timezone: "Europe/Moscow",
        filters: {},
        scopeVisibility: "assigned" as const,
        state: "completed" as const,
        result: {},
        excludedRecords: 0,
        dataFreshAt: "2026-08-06T10:00:00.000Z",
        createdByUserAccountId: actor.userAccountId,
        createdAt: "2026-08-06T10:00:00.000Z",
        version: 1 as const,
      },
    }));
    const { service } = fixture({ runReport });
    const body = {
      reportCode: "pipeline.summary" as const,
      timezone: "Europe/Moscow",
      filters: { status: "active" },
      reason: "Еженедельный контроль воронки",
    };

    await service.runReport(actor, "report-key-0001", body);
    await service.runReport(actor, "report-key-0001", {
      reason: body.reason,
      filters: body.filters,
      timezone: body.timezone,
      reportCode: body.reportCode,
    });
    const first = runReport.mock.calls[0]?.[0];
    const second = runReport.mock.calls[1]?.[0];
    expect(first).toMatchObject({ formulaVersion: "pipeline.summary@1", idempotencyKey: "report-key-0001" });
    expect(first?.requestHash).toBe(second?.requestHash);
  });

  it("exports only the stored aggregate and records a bounded CSV manifest", async () => {
    const getReportRun = vi.fn(async () => ({
      id: "40000000-0000-4000-8000-000000000001",
      publicId: "report_1",
      reportCode: "pipeline.summary" as const,
      formulaVersion: "pipeline.summary@1",
      timezone: "Europe/Moscow",
      filters: {},
      scopeVisibility: "assigned" as const,
      state: "completed" as const,
      result: { dimensions: [{ stageCode: "new", status: "active", count: 12 }], total: 12 },
      excludedRecords: 0,
      dataFreshAt: "2026-08-06T10:00:00.000Z",
      createdByUserAccountId: actor.userAccountId,
      createdAt: "2026-08-06T10:00:00.000Z",
      version: 1 as const,
    }));
    const recordReportExport = vi.fn(async () => ({ replayed: false }));
    const { service, authorize } = fixture({ getReportRun, recordReportExport });

    const result = await service.exportReport(actor, "report_1", "export-key-0001");
    expect(result.value).toMatchObject({
      format: "csv",
      mediaType: "text/csv; charset=utf-8",
      reportCode: "pipeline.summary",
      sourceDataFreshAt: "2026-08-06T10:00:00.000Z",
    });
    expect(result.value.content).toContain('"stageCode","status","count"');
    expect(result.value.content).toContain('"new","active","12"');
    expect(result.value.byteSize).toBeLessThanOrEqual(5_000_000);
    expect(recordReportExport).toHaveBeenCalledWith(
      expect.objectContaining({
        reportRunId: "40000000-0000-4000-8000-000000000001",
        sha256: result.value.sha256,
        byteSize: result.value.byteSize,
      }),
    );
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ permissionCode: "crm.report.export" }));
  });

  it("requires global scope and never permits disabling four-eyes settings", async () => {
    const updateSetting = vi.fn();
    const assigned = fixture({ updateSetting });
    await expect(
      assigned.service.updateSetting(actor, "crm.dashboard.policy", 0, {
        config: { overdueWarningHours: 24 },
        reason: "Первичная настройка dashboard",
      }),
    ).rejects.toMatchObject({ statusCode: 403, code: "global_scope_required" });

    const global = fixture(
      { updateSetting },
      { ...assignedAccess, visibility: "all", employeeProfileIds: [] },
    );
    await expect(
      global.service.updateSetting(actor, "crm.communication.policy", 0, {
        config: {
          maxRecipientsPerDraft: 100,
          requiresFourEyes: false as never,
          enabledChannels: ["email"],
        },
        reason: "Попытка изменить контур согласования",
      }),
    ).rejects.toMatchObject({ statusCode: 422, code: "four_eyes_cannot_be_disabled" });
    expect(updateSetting).not.toHaveBeenCalled();
  });
});
