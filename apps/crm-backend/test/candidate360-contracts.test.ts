import swagger from "@fastify/swagger";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerErrorHandling } from "../src/common/errors.js";
import {
  candidate360Plugin,
  candidateDocumentContentDisposition,
  parseCandidate360IfMatchVersion,
} from "../src/modules/candidate360/plugin.js";
import type { Candidate360ServicePort } from "../src/modules/candidate360/ports.js";
import {
  CANDIDATE_360_OPERATION_LIST,
  CANDIDATE_360_OPERATIONS,
} from "../src/modules/candidate360/registry.js";
import type { CrmActorContext } from "../src/modules/crm/ports.js";

const apps: Fastify.FastifyInstance[] = [];
const actor: CrmActorContext = {
  userAccountId: "10000000-0000-4000-8000-000000000001",
  employeeProfileId: "20000000-0000-4000-8000-000000000001",
  requestId: "request-1",
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("Candidate 360 OpenAPI contract", () => {
  it("publishes each registry operation with an explicit permission", async () => {
    const app = Fastify();
    apps.push(app);
    await app.register(swagger, {
      openapi: {
        info: { title: "Candidate 360 contract", version: "1.0.0" },
        components: {
          securitySchemes: {
            sessionCookie: { type: "apiKey", in: "cookie", name: "crm_session" },
            csrfToken: { type: "apiKey", in: "header", name: "X-CSRF-Token" },
          },
        },
      },
    });
    registerErrorHandling(app);
    await app.register(candidate360Plugin, {
      service: {} as Candidate360ServicePort,
      resolveActor: async () => actor,
      verifyMutationRequest: async () => undefined,
    });
    await app.ready();

    const document = app.swagger() as {
      paths?: Record<string, Record<string, { operationId?: string; "x-permission-code"?: string }>>;
    };
    for (const operation of CANDIDATE_360_OPERATION_LIST) {
      const path = operation.path.replace(/:([^/]+)/g, "{$1}");
      const route = document.paths?.[path]?.[operation.method.toLowerCase()];
      expect(route, `${operation.method} ${path}`).toBeDefined();
      expect(route?.operationId).toBe(operation.operationId);
      expect(route?.["x-permission-code"]).toBe(operation.permissionCode);
    }
    expect(CANDIDATE_360_OPERATION_LIST).toHaveLength(Object.keys(CANDIDATE_360_OPERATIONS).length);
  });

  it("requires If-Match and returns the incremented duplicate ETag", async () => {
    const mergeCandidate = vi.fn(async () => ({
      mergeId: "40000000-0000-4000-8000-000000000001",
      duplicateCandidateId: "30000000-0000-4000-8000-000000000001",
      survivorPersonId: "50000000-0000-4000-8000-000000000001",
      mergedPersonId: "50000000-0000-4000-8000-000000000002",
      state: "active" as const,
      reversible: true as const,
      mergeVersion: 1,
      duplicateVersion: 8,
      reviewedByUserAccountId: actor.userAccountId,
      reason: "Дубль проверен вручную",
      provenance: { origin: "manual" as const },
      mergedAt: "2026-08-06T10:00:00.000Z",
    }));
    const app = Fastify();
    apps.push(app);
    registerErrorHandling(app);
    await app.register(candidate360Plugin, {
      service: { mergeCandidate } as unknown as Candidate360ServicePort,
      resolveActor: async (request) => ({ ...actor, requestId: request.id }),
      verifyMutationRequest: async () => undefined,
    });

    const url = "/internal/v1/crm/candidate-duplicates/30000000-0000-4000-8000-000000000001/merge";
    const payload = {
      survivorPersonId: "50000000-0000-4000-8000-000000000001",
      reason: "Дубль проверен вручную",
    };
    const missing = await app.inject({
      method: "POST",
      url,
      headers: { "x-csrf-token": "csrf-token-for-contract-test" },
      payload,
    });
    expect(missing.statusCode).toBe(428);
    expect(missing.json()).toMatchObject({ code: "precondition_required" });

    const response = await app.inject({
      method: "POST",
      url,
      headers: {
        "if-match": '"v7"',
        "x-csrf-token": "csrf-token-for-contract-test",
      },
      payload,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"v8"');
    expect(mergeCandidate).toHaveBeenCalledWith(
      expect.objectContaining({ userAccountId: actor.userAccountId }),
      "30000000-0000-4000-8000-000000000001",
      7,
      payload,
    );
  });

  it("returns binary document content without disclosing its object-store key", async () => {
    const bytes = new TextEncoder().encode("safe document body");
    const app = Fastify();
    apps.push(app);
    registerErrorHandling(app);
    await app.register(candidate360Plugin, {
      service: {
        getCandidateDocumentContent: async () => ({
          documentId: "60000000-0000-4000-8000-000000000001",
          originalName: "резюме.pdf",
          mediaType: "application/pdf",
          byteSize: bytes.byteLength,
          sha256: "a".repeat(64),
          bytes,
        }),
      } as unknown as Candidate360ServicePort,
      resolveActor: async () => actor,
      verifyMutationRequest: async () => undefined,
    });

    const response = await app.inject({
      method: "GET",
      url: "/internal/v1/crm/documents/60000000-0000-4000-8000-000000000001/content",
    });

    expect(response.statusCode).toBe(200);
    expect(response.rawPayload).toEqual(Buffer.from(bytes));
    expect(response.headers["content-type"]).toContain("application/pdf");
    expect(response.headers["content-disposition"]).toContain("filename*=UTF-8''");
    expect(response.headers).not.toHaveProperty("x-storage-key");
  });
});

describe("Candidate document download header", () => {
  it("removes path separators and control characters", () => {
    const value = candidateDocumentContentDisposition("../resume\r\nX-Evil: yes.pdf");
    expect(value).not.toMatch(/[\r\n]/u);
    expect(value).not.toContain("../");
    expect(value).toContain("attachment;");
  });
});

describe("Candidate 360 If-Match parser", () => {
  it.each([
    ["3", 3],
    ["v3", 3],
    ['"3"', 3],
    ['"v3"', 3],
  ])("parses %s", (value, version) => {
    expect(parseCandidate360IfMatchVersion(value)).toBe(version);
  });

  it.each(["*", "0", 'W/"3"', "3, 4"])("rejects %s", (value) => {
    expect(() => parseCandidate360IfMatchVersion(value)).toThrowError(/If-Match|формат/);
  });
});
