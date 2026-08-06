import swagger from "@fastify/swagger";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerErrorHandling } from "../src/common/errors.js";
import type { CrmCaseDetail } from "../src/modules/crm/contracts.js";
import { crmPlugin, parseCrmIfMatchVersion } from "../src/modules/crm/plugin.js";
import type { CrmActorContext, CrmServicePort } from "../src/modules/crm/ports.js";
import { CRM_STATE_REGISTRY, createCrmStateRegistry } from "../src/registry/crm-state-registry.js";
import { CRM_OPERATION_LIST, CRM_OPERATIONS } from "../src/registry/operation-registry.js";

const apps: Fastify.FastifyInstance[] = [];

const actor: CrmActorContext = {
  userAccountId: "user-1",
  employeeProfileId: "employee-1",
  requestId: "request-1",
};

const caseDetail: CrmCaseDetail = {
  id: "case-internal-1",
  publicId: "case-1",
  title: "Переезд в Мурманск",
  funnelCode: "relocation",
  funnelVersion: 1,
  stageCode: "qualification",
  status: "open",
  nextStep: "Проверить документы",
  primaryPersonId: "person-1",
  ownerEmployeeProfileId: "employee-1",
  version: 8,
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-06T10:00:00.000Z",
  people: [
    {
      personId: "person-1",
      relationshipType: "candidate",
      isPrimary: true,
      displayName: "Иван П.",
    },
  ],
  assignments: [
    {
      employeeProfileId: "employee-1",
      legacyActorId: null,
      role: "owner",
      validFrom: "2026-08-01T10:00:00.000Z",
      validTo: null,
    },
  ],
  relocation: null,
  attributes: {},
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("CRM operation and OpenAPI contracts", () => {
  it("assigns a unique permission-bearing registry entry to every route", () => {
    const routes = new Set<string>();
    const operationIds = new Set<string>();

    for (const operation of CRM_OPERATION_LIST) {
      expect(operation.permissionCode).toMatch(/^crm\./);
      expect(operation.operationId).not.toHaveLength(0);
      expect(routes.has(`${operation.method} ${operation.path}`)).toBe(false);
      expect(operationIds.has(operation.operationId)).toBe(false);
      routes.add(`${operation.method} ${operation.path}`);
      operationIds.add(operation.operationId);
    }

    expect(CRM_OPERATION_LIST).toHaveLength(Object.keys(CRM_OPERATIONS).length);
  });

  it("publishes every registry operation in OpenAPI with the same permission", async () => {
    const app = Fastify();
    apps.push(app);
    await app.register(swagger, {
      openapi: {
        info: { title: "CRM contract test", version: "1.0.0" },
        components: {
          securitySchemes: {
            sessionCookie: { type: "apiKey", in: "cookie", name: "crm_session" },
            csrfToken: { type: "apiKey", in: "header", name: "X-CSRF-Token" },
          },
        },
      },
    });
    registerErrorHandling(app);
    await app.register(crmPlugin, {
      service: {} as CrmServicePort,
      resolveActor: async () => actor,
      verifyMutationRequest: async () => undefined,
    });
    await app.ready();

    const document = app.swagger() as {
      paths?: Record<string, Record<string, { operationId?: string; "x-permission-code"?: string }>>;
    };

    for (const operation of CRM_OPERATION_LIST) {
      const openApiPath = operation.path.replace(/:([^/]+)/g, "{$1}");
      const route = document.paths?.[openApiPath]?.[operation.method.toLowerCase()];
      expect(route, `${operation.method} ${openApiPath}`).toBeDefined();
      expect(route?.operationId).toBe(operation.operationId);
      expect(route?.["x-permission-code"]).toBe(operation.permissionCode);
    }
  });

  it("enforces If-Match and returns the new ETag for case transitions", async () => {
    const transitionCase = vi.fn(async () => caseDetail);
    const app = Fastify();
    apps.push(app);
    registerErrorHandling(app);
    await app.register(crmPlugin, {
      service: { transitionCase } as unknown as CrmServicePort,
      resolveActor: async (request) => ({ ...actor, requestId: request.id }),
      verifyMutationRequest: async () => undefined,
    });

    const missing = await app.inject({
      method: "POST",
      url: "/internal/v1/crm/cases/case-1/transitions",
      headers: { "x-csrf-token": "csrf-token-for-contract-test" },
      payload: { toStageCode: "qualification" },
    });
    expect(missing.statusCode).toBe(428);
    expect(missing.json()).toMatchObject({ code: "precondition_required" });

    const response = await app.inject({
      method: "POST",
      url: "/internal/v1/crm/cases/case-1/transitions",
      headers: {
        "if-match": '"v7"',
        "x-csrf-token": "csrf-token-for-contract-test",
      },
      payload: { toStageCode: "qualification" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"v8"');
    expect(transitionCase).toHaveBeenCalledWith(
      expect.objectContaining({ userAccountId: "user-1" }),
      "case-1",
      7,
      { toStageCode: "qualification" },
    );
  });
});

describe("CRM state registry", () => {
  it("keeps post_relocation explicit but fail-closed until its lifecycle is approved", () => {
    const definition = CRM_STATE_REGISTRY.get("case", "post_relocation", 1);
    expect(definition).toMatchObject({
      code: "post_relocation",
      version: 1,
      status: "draft",
      initialState: null,
    });
    expect(definition?.transitions).toEqual([]);
  });

  it("supports an approved post_relocation lifecycle without changing service code", () => {
    const registry = createCrmStateRegistry([
      {
        kind: "case",
        code: "post_relocation",
        version: 7,
        title: "После переезда",
        status: "active",
        source: "process-owner-approved-contract",
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

    expect(
      registry.resolveTransition("case", "post_relocation", 7, "registered", "employed")?.transition.code,
    ).toBe("record_employment");
  });
});

describe("CRM If-Match parser", () => {
  it.each([
    ["7", 7],
    ["v7", 7],
    ['"7"', 7],
    ['"v7"', 7],
  ])("parses %s", (value, version) => {
    expect(parseCrmIfMatchVersion(value)).toBe(version);
  });

  it.each(["*", "0", 'W/"7"', 'W/"v7"', '"v7', "7, 8"])("rejects %s", (value) => {
    expect(() => parseCrmIfMatchVersion(value)).toThrowError(/If-Match|верс/);
  });
});
