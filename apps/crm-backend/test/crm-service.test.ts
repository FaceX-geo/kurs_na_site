import { describe, expect, it, vi } from "vitest";
import type { CrmCaseDetail, CrmCaseTransitionResult } from "../src/modules/crm/contracts.js";
import type {
  CrmAccessScope,
  CrmActorContext,
  CrmAuthorizationPort,
  CrmRepositoryPort,
} from "../src/modules/crm/ports.js";
import { createCrmService } from "../src/modules/crm/service.js";
import { CRM_DICTIONARY_REGISTRY } from "../src/registry/crm-dictionary-registry.js";
import { CRM_STATE_REGISTRY, createCrmStateRegistry } from "../src/registry/crm-state-registry.js";

const signingKey = "crm-contract-test-signing-key-32-bytes-minimum";
const idempotencyKey = "case-transition-key-0001";

const actor: CrmActorContext = {
  userAccountId: "user-1",
  employeeProfileId: "employee-1",
  requestId: "request-1",
};

const access: CrmAccessScope = {
  visibility: "assigned",
  actorUserAccountId: actor.userAccountId,
  actorEmployeeProfileId: actor.employeeProfileId,
  employeeProfileIds: ["employee-1"],
  teamIds: [],
  organizationUnitIds: [],
  fieldMask: [],
};

function aCase(overrides: Partial<CrmCaseDetail> = {}): CrmCaseDetail {
  return {
    id: "case-internal-1",
    publicId: "case-1",
    title: "Кейс",
    funnelCode: "relocation",
    funnelVersion: 1,
    stageCode: "new",
    status: "open",
    nextStep: null,
    primaryPersonId: "person-1",
    ownerEmployeeProfileId: "employee-1",
    version: 3,
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-06T10:00:00.000Z",
    people: [],
    assignments: [],
    relocation: null,
    attributes: {},
    ...overrides,
  };
}

function transitionResponse(value: CrmCaseDetail): CrmCaseTransitionResult {
  return {
    case: value,
    receipt: {
      id: "audit-event-1",
      auditEventId: "audit-event-1",
      operationId: "TransitionCase",
      requestId: actor.requestId,
      caseId: value.id,
      version: value.version,
      occurredAt: "2026-08-06T10:00:00.000Z",
    },
  };
}

function updatedTransition(value: CrmCaseDetail) {
  return {
    kind: "updated" as const,
    value: { value: transitionResponse(value), replayed: false },
  };
}

function serviceFixture(repository: Partial<CrmRepositoryPort>, stateRegistry = CRM_STATE_REGISTRY) {
  const authorize = vi.fn(async () => access);
  const authorization: CrmAuthorizationPort = { authorize };
  const service = createCrmService({
    repository: {
      findCaseTransitionReplay: async () => null,
      ...repository,
    } as CrmRepositoryPort,
    authorization,
    stateRegistry,
    dictionaryRegistry: CRM_DICTIONARY_REGISTRY,
    cursorSigningKey: signingKey,
    requestHashingKey: signingKey,
  });
  return { service, authorize };
}

describe("CRM application service", () => {
  it("executes a registry-provided post_relocation transition atomically", async () => {
    const registry = createCrmStateRegistry([
      {
        kind: "case",
        code: "post_relocation",
        version: 7,
        title: "После переезда",
        status: "active",
        source: "approved-contract",
        initialState: "registered",
        states: [
          { code: "registered", title: "Зарегистрирован", order: 10 },
          { code: "employed", title: "Трудоустроен", order: 20 },
        ],
        transitions: [
          {
            code: "record_employment",
            from: ["registered"],
            to: ["employed"],
            permissionCode: "crm.case.transition",
            requiredFields: ["employer_id"],
            reasonRequired: false,
          },
        ],
      },
    ]);
    const before = aCase({
      funnelCode: "post_relocation",
      funnelVersion: 7,
      stageCode: "registered",
    });
    const after = aCase({
      funnelCode: "post_relocation",
      funnelVersion: 7,
      stageCode: "employed",
      version: 4,
    });
    const transitionCase = vi.fn(async () => updatedTransition(after));
    const { service } = serviceFixture({ getCase: async () => before, transitionCase }, registry);

    const result = await service.transitionCase(actor, "case-1", 3, idempotencyKey, {
      toStageCode: "employed",
      evidence: { employer_id: "employer-1" },
    });

    expect(result).toEqual({ value: transitionResponse(after), replayed: false });
    expect(transitionCase).toHaveBeenCalledWith(
      expect.objectContaining({
        aggregateId: "case-internal-1",
        expectedVersion: 3,
        fromState: "registered",
        toState: "employed",
        machineCode: "post_relocation",
        machineVersion: 7,
        transition: expect.objectContaining({ code: "record_employment" }),
        targetAggregateStatus: null,
        evidence: expect.objectContaining({ employer_id: "employer-1" }),
      }),
    );
  });

  it("keeps the unapproved baseline post_relocation lifecycle read-only", async () => {
    const current = aCase({
      funnelCode: "post_relocation",
      funnelVersion: 1,
      stageCode: "legacy_stage",
    });
    const { service } = serviceFixture({ getCase: async () => current });

    await expect(
      service.transitionCase(actor, "case-1", 3, idempotencyKey, { toStageCode: "employed" }),
    ).rejects.toMatchObject({ statusCode: 409, code: "state_machine_not_active" });
  });

  it("requires the registry permission for a reopen transition", async () => {
    const before = aCase({ stageCode: "closed_unsuccessful" });
    const after = aCase({ stageCode: "new", version: 4 });
    const transitionCase = vi.fn(async () => updatedTransition(after));
    const { service, authorize } = serviceFixture({
      getCase: async () => before,
      transitionCase,
    });

    await service.transitionCase(actor, "case-1", 3, idempotencyKey, {
      toStageCode: "new",
      reasonText: "Исправлены исходные данные",
    });

    expect(authorize).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ permissionCode: "crm.case.transition" }),
    );
    expect(authorize).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ permissionCode: "crm.case.reopen" }),
    );
  });

  it("passes registry-defined aggregate status to the atomic repository command", async () => {
    const before = aCase({ stageCode: "new", status: "open" });
    const after = aCase({ stageCode: "qualification", status: "open", version: 4 });
    const transitionCase = vi.fn(async () => updatedTransition(after));
    const { service } = serviceFixture({ getCase: async () => before, transitionCase });

    await service.transitionCase(actor, "case-1", 3, idempotencyKey, {
      toStageCode: "qualification",
      evidence: { owner_id: "employee-1", next_step: "Позвонить" },
    });

    expect(transitionCase).toHaveBeenCalledWith(expect.objectContaining({ targetAggregateStatus: "open" }));
  });

  it("signs and verifies stable repository cursors", async () => {
    const listCases = vi
      .fn()
      .mockResolvedValueOnce({
        items: [],
        nextCursor: { createdAt: "2026-08-06T10:00:00.000Z", id: "case-1" },
        hasMore: true,
      })
      .mockResolvedValueOnce({ items: [], nextCursor: null, hasMore: false });
    const { service } = serviceFixture({ listCases });

    const first = await service.listCases(actor, { limit: 20 });
    expect(first.page.nextCursor).toEqual(expect.any(String));
    const nextCursor = first.page.nextCursor;
    if (!nextCursor) {
      throw new Error("Expected the first page to contain a cursor");
    }

    await service.listCases(actor, { limit: 20, cursor: nextCursor });
    expect(listCases).toHaveBeenNthCalledWith(
      2,
      access,
      expect.objectContaining({
        limit: 20,
        cursor: { createdAt: "2026-08-06T10:00:00.000Z", id: "case-1" },
      }),
    );

    await expect(
      service.listCases(actor, {
        limit: 20,
        cursor: nextCursor,
        status: "completed",
      }),
    ).rejects.toMatchObject({ statusCode: 422, code: "invalid_cursor" });
    expect(listCases).toHaveBeenCalledTimes(2);
  });

  it("returns a deterministic conflict before attempting a stale mutation", async () => {
    const transitionCase = vi.fn();
    const { service } = serviceFixture({
      getCase: async () => aCase({ version: 9 }),
      transitionCase,
    });

    await expect(
      service.transitionCase(actor, "case-1", 3, idempotencyKey, { toStageCode: "qualification" }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "version_conflict",
      details: { expectedVersion: 3, currentVersion: 9 },
    });
    expect(transitionCase).not.toHaveBeenCalled();
  });

  it("returns an authoritative completed replay before applying stale If-Match checks", async () => {
    const replay = transitionResponse(aCase({ stageCode: "qualification", version: 4 }));
    const findCaseTransitionReplay = vi.fn(async () => replay);
    const transitionCase = vi.fn();
    const { service } = serviceFixture({
      getCase: async () => aCase({ stageCode: "documents", version: 9 }),
      findCaseTransitionReplay,
      transitionCase,
    });

    await expect(
      service.transitionCase(actor, "case-1", 3, idempotencyKey, {
        toStageCode: "qualification",
      }),
    ).resolves.toEqual({ value: replay, replayed: true });
    expect(findCaseTransitionReplay).toHaveBeenCalledWith(
      expect.objectContaining({
        aggregateId: "case-internal-1",
        idempotency: expect.objectContaining({
          key: idempotencyKey,
          scope: "crm.case.transition:user-1:case-internal-1",
          requestHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      }),
    );
    expect(transitionCase).not.toHaveBeenCalled();
  });

  it("rejects an invalid expected version before authorization or repository access", async () => {
    const getCase = vi.fn();
    const { service, authorize } = serviceFixture({ getCase });

    await expect(
      service.transitionCase(actor, "case-1", 0, idempotencyKey, { toStageCode: "qualification" }),
    ).rejects.toMatchObject({ statusCode: 422, code: "invalid_expected_version" });
    expect(authorize).not.toHaveBeenCalled();
    expect(getCase).not.toHaveBeenCalled();
  });
});
