import { describe, expect, it, vi } from "vitest";
import type {
  CrmCaseDetail,
  CrmEmployerDetail,
  CrmReferralDetail,
  CrmTaskDetail,
} from "../src/modules/crm/contracts.js";
import type { CrmAccessScope, CrmActorContext, CrmAuthorizationPort } from "../src/modules/crm/ports.js";
import type { CrmCommandRepositoryPort } from "../src/modules/crm-commands/ports.js";
import { createCrmCommandService } from "../src/modules/crm-commands/service.js";

const actor: CrmActorContext = {
  userAccountId: "user-1",
  employeeProfileId: "employee-1",
  requestId: "request-1",
};

const assignedAccess: CrmAccessScope = {
  visibility: "assigned",
  actorUserAccountId: actor.userAccountId,
  actorEmployeeProfileId: actor.employeeProfileId,
  employeeProfileIds: ["employee-1"],
  teamIds: [],
  organizationUnitIds: [],
  fieldMask: [],
};

const caseDetail = {
  id: "case-id",
  publicId: "case-public-id",
  title: "Кейс кандидата",
  funnelCode: "relocation",
  funnelVersion: 1,
  stageCode: "qualification",
  status: "open",
  nextStep: null,
  primaryPersonId: "person-id",
  ownerEmployeeProfileId: "employee-1",
  version: 4,
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-06T10:00:00.000Z",
  people: [],
  assignments: [],
  relocation: null,
  attributes: {},
} satisfies CrmCaseDetail;

function fixture(
  repositoryOverrides: Partial<CrmCommandRepositoryPort>,
  access: CrmAccessScope = assignedAccess,
) {
  const repository = repositoryOverrides as CrmCommandRepositoryPort;
  const authorize = vi.fn(async () => access);
  const authorization: CrmAuthorizationPort = { authorize };
  const service = createCrmCommandService({
    repository,
    authorization,
    requestHashingKey: "crm-command-test-request-hashing-key-32-bytes",
  });
  return { service, authorize };
}

describe("CRM command service", () => {
  it("rejects an update without mutable fields before repository access", async () => {
    const updateCase = vi.fn();
    const { service, authorize } = fixture({ updateCase });

    await expect(
      service.updateCase(actor, "case-public-id", 3, { reason: "Контрольная проверка" }),
    ).rejects.toMatchObject({ statusCode: 422, code: "empty_update" });

    expect(authorize).not.toHaveBeenCalled();
    expect(updateCase).not.toHaveBeenCalled();
  });

  it("rejects whitespace-only aggregate titles after transport validation", async () => {
    const updateCase = vi.fn();
    const { service } = fixture({ updateCase });

    await expect(
      service.updateCase(actor, "case-public-id", 3, { title: "   ", reason: "Исправление" }),
    ).rejects.toMatchObject({ statusCode: 422, code: "case_title_required" });
    expect(updateCase).not.toHaveBeenCalled();
  });

  it("does not let a scoped employee orphan a case they may no longer see", async () => {
    const updateCase = vi.fn();
    const { service } = fixture({ updateCase });

    await expect(
      service.updateCase(actor, "case-public-id", 3, {
        ownerEmployeeProfileId: null,
        reason: "Перераспределение",
      }),
    ).rejects.toMatchObject({ statusCode: 422, code: "case_owner_required_for_scoped_actor" });
    expect(updateCase).not.toHaveBeenCalled();
  });

  it("passes optimistic locking and the resolved SQL scope to the repository", async () => {
    const updateCase = vi.fn(async () => ({ kind: "updated" as const, value: caseDetail }));
    const { service, authorize } = fixture({ updateCase });

    const result = await service.updateCase(actor, "case-public-id", 3, {
      nextStep: "Запросить документы",
      reason: "Актуализация плана",
    });

    expect(result).toBe(caseDetail);
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        permissionCode: "crm.case.update",
        resource: { type: "crm_case", id: "case-public-id" },
      }),
    );
    expect(updateCase).toHaveBeenCalledWith(
      expect.objectContaining({ access: assignedAccess, expectedVersion: 3, resourceId: "case-public-id" }),
    );
  });

  it("requires a human review reason when an employer has no tax id", async () => {
    const createEmployer = vi.fn();
    const { service } = fixture({ createEmployer });

    await expect(
      service.createEmployer(actor, "employer-idempotency-1", {
        name: "Работодатель",
        organizationType: "legal_entity",
      }),
    ).rejects.toMatchObject({ statusCode: 422, code: "manual_review_reason_required" });
    expect(createEmployer).not.toHaveBeenCalled();
  });

  it("builds a deterministic request hash for idempotent employer creation", async () => {
    const value = { version: 1 } as CrmEmployerDetail;
    const createEmployer = vi.fn(
      async (_command: Parameters<CrmCommandRepositoryPort["createEmployer"]>[0]) => ({
        value,
        replayed: false,
      }),
    );
    const { service } = fixture({ createEmployer });
    const input = {
      name: "Работодатель",
      organizationType: "legal_entity" as const,
      taxId: "1234567890",
    };

    await service.createEmployer(actor, "employer-idempotency-1", input);
    await service.createEmployer(actor, "employer-idempotency-2", { ...input });

    expect(createEmployer.mock.calls[0]?.[0].requestHash).toBe(createEmployer.mock.calls[1]?.[0].requestHash);
    expect(createEmployer.mock.calls[0]?.[0].requestHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("requires every task to reference exactly one CRM aggregate", async () => {
    const createTask = vi.fn(async () => ({ value: { version: 1 } as CrmTaskDetail, replayed: false }));
    const { service } = fixture({ createTask });
    const common = {
      title: "Проверить документы",
      responsibleEmployeeProfileId: "e1234567-e89b-42d3-a456-426614174000",
    };

    await expect(service.createTask(actor, "task-idempotency-1", common)).rejects.toMatchObject({
      statusCode: 422,
      code: "linked_crm_object_required",
    });
    await expect(
      service.createTask(actor, "task-idempotency-2", {
        ...common,
        caseId: "case-id",
        employerReferralId: "referral-id",
      }),
    ).rejects.toMatchObject({ statusCode: 422, code: "linked_crm_object_required" });
    expect(createTask).not.toHaveBeenCalled();
  });

  it("turns stale referral versions into an explicit conflict", async () => {
    const transitionReferral = vi.fn(async () => ({ kind: "version_conflict" as const, currentVersion: 8 }));
    const { service } = fixture({ transitionReferral });

    await expect(
      service.transitionReferral(actor, "referral-id", 3, { toStageCode: "accepted" }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "version_conflict",
      details: { expectedVersion: 3, currentVersion: 8 },
    });
  });

  it("returns repository results for referral creation without hiding replay state", async () => {
    const value = { version: 1 } as CrmReferralDetail;
    const createReferral = vi.fn(async () => ({ value, replayed: true }));
    const { service } = fixture({ createReferral });

    await expect(
      service.createReferral(actor, "referral-idempotency-1", {
        caseId: "case-id",
        employerId: "employer-id",
      }),
    ).resolves.toEqual({ value, replayed: true });
  });
});
