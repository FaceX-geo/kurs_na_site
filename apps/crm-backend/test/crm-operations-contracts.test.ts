import swagger from "@fastify/swagger";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerErrorHandling } from "../src/common/errors.js";
import type { CrmActorContext } from "../src/modules/crm/ports.js";
import {
  crmOperationsPlugin,
  parseCrmOperationsIfMatchVersion,
} from "../src/modules/crm-operations/plugin.js";
import type { CrmOperationsServicePort } from "../src/modules/crm-operations/ports.js";
import {
  CRM_OPERATIONS_OPERATION_LIST,
  CRM_OPERATIONS_OPERATIONS,
} from "../src/modules/crm-operations/registry.js";

const apps: Fastify.FastifyInstance[] = [];
const actor: CrmActorContext = {
  userAccountId: "10000000-0000-4000-8000-000000000001",
  employeeProfileId: "20000000-0000-4000-8000-000000000001",
  requestId: "request-1",
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("CRM operations OpenAPI contract", () => {
  it("publishes every registry operation with an explicit permission", async () => {
    const app = Fastify();
    apps.push(app);
    await app.register(swagger, {
      openapi: {
        info: { title: "CRM operations contract", version: "1.0.0" },
        components: {
          securitySchemes: {
            sessionCookie: { type: "apiKey", in: "cookie", name: "crm_session" },
            csrfToken: { type: "apiKey", in: "header", name: "X-CSRF-Token" },
          },
        },
      },
    });
    registerErrorHandling(app);
    await app.register(crmOperationsPlugin, {
      service: {} as CrmOperationsServicePort,
      resolveActor: async () => actor,
      verifyMutationRequest: async () => undefined,
    });
    await app.ready();

    const document = app.swagger() as {
      paths?: Record<string, Record<string, { operationId?: string; "x-permission-code"?: string }>>;
    };
    for (const operation of CRM_OPERATIONS_OPERATION_LIST) {
      const path = operation.path.replace(/:([^/]+)/g, "{$1}");
      const route = document.paths?.[path]?.[operation.method.toLowerCase()];
      expect(route, `${operation.method} ${path}`).toBeDefined();
      expect(route?.operationId).toBe(operation.operationId);
      expect(route?.["x-permission-code"]).toBe(operation.permissionCode);
    }
    expect(CRM_OPERATIONS_OPERATION_LIST).toHaveLength(Object.keys(CRM_OPERATIONS_OPERATIONS).length);
    const queueResponse = document.paths?.["/internal/v1/crm/communication-drafts/{draftId}/queue"]?.post as
      | {
          responses?: Record<string, { headers?: Record<string, unknown> }>;
        }
      | undefined;
    expect(queueResponse?.responses?.["200"]?.headers).toMatchObject({
      ETag: expect.any(Object),
      "Idempotency-Replayed": expect.any(Object),
    });
  });

  it("approves a draft with If-Match while preserving the no-delivery boundary", async () => {
    const confirmCommunicationDraft = vi.fn(async () => ({
      id: "30000000-0000-4000-8000-000000000001",
      publicId: "communication_1",
      channel: "email" as const,
      subject: "Важная информация",
      body: "Текст",
      recipientPersonIds: ["40000000-0000-4000-8000-000000000001"],
      recipientCount: 1,
      selectionFingerprint: "a".repeat(64),
      state: "confirmed" as const,
      deliveryBoundary: "approval_only" as const,
      externalDeliveryState: "not_requested" as const,
      createdByUserAccountId: "10000000-0000-4000-8000-000000000002",
      confirmedByUserAccountId: actor.userAccountId,
      confirmedAt: "2026-08-06T10:00:00.000Z",
      queuedAt: null,
      version: 4,
      createdAt: "2026-08-06T09:00:00.000Z",
      updatedAt: "2026-08-06T10:00:00.000Z",
    }));
    const app = Fastify();
    apps.push(app);
    registerErrorHandling(app);
    await app.register(crmOperationsPlugin, {
      service: { confirmCommunicationDraft } as unknown as CrmOperationsServicePort,
      resolveActor: async (request) => ({ ...actor, requestId: request.id }),
      verifyMutationRequest: async () => undefined,
    });

    const response = await app.inject({
      method: "POST",
      url: "/internal/v1/crm/communication-drafts/30000000-0000-4000-8000-000000000001/approvals",
      headers: { "if-match": '"v3"', "x-csrf-token": "csrf-token-for-contract-test" },
      payload: {
        selectionFingerprint: "a".repeat(64),
        reason: "Состав получателей проверен вторым сотрудником",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"v4"');
    expect(response.json()).toMatchObject({
      state: "confirmed",
      queuedAt: null,
      deliveryBoundary: "approval_only",
      externalDeliveryState: "not_requested",
    });
    expect(confirmCommunicationDraft).toHaveBeenCalledWith(
      expect.objectContaining({ userAccountId: actor.userAccountId }),
      "30000000-0000-4000-8000-000000000001",
      3,
      expect.objectContaining({ selectionFingerprint: "a".repeat(64) }),
    );
  });

  it("queues only through the idempotent internal durable boundary", async () => {
    const queueCommunication = vi.fn(async () => ({
      replayed: true,
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
    }));
    const app = Fastify();
    apps.push(app);
    registerErrorHandling(app);
    await app.register(crmOperationsPlugin, {
      service: { queueCommunication } as unknown as CrmOperationsServicePort,
      resolveActor: async (request) => ({ ...actor, requestId: request.id }),
      verifyMutationRequest: async () => undefined,
    });

    const response = await app.inject({
      method: "POST",
      url: "/internal/v1/crm/communication-drafts/30000000-0000-4000-8000-000000000001/queue",
      headers: {
        "if-match": '"v4"',
        "idempotency-key": "queue-key-0001",
        "x-csrf-token": "csrf-token-for-contract-test",
      },
      payload: {
        selectionFingerprint: "a".repeat(64),
        reason: "Подтверждённая коммуникация готова к очереди",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"v5"');
    expect(response.headers["idempotency-replayed"]).toBe("true");
    expect(response.json()).toMatchObject({
      state: "queued",
      deliveryBoundary: "durable_outbox_only",
      externalDeliveryState: "queued_internal",
    });
  });
});

describe("CRM operations If-Match parser", () => {
  it.each([
    ["3", false, 3],
    ["v3", false, 3],
    ['"v3"', false, 3],
    ['"v0"', true, 0],
  ])("parses %s", (value, allowZero, version) => {
    expect(parseCrmOperationsIfMatchVersion(value, allowZero)).toBe(version);
  });

  it.each(["*", "0", 'W/"3"', "3, 4"])("rejects %s for regular mutations", (value) => {
    expect(() => parseCrmOperationsIfMatchVersion(value)).toThrowError(/If-Match|формат/);
  });
});
