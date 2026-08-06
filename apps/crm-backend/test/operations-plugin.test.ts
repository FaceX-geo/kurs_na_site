import swagger from "@fastify/swagger";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { operationsPlugin } from "../src/modules/operations/plugin.js";
import type { OperationsReadServicePort } from "../src/modules/operations/ports.js";
import { OPERATIONS_LIST } from "../src/modules/operations/registry.js";

function serviceMock(): OperationsReadServicePort {
  return {
    listMigrationRuns: vi.fn(async () => ({
      items: [],
      page: { limit: 50, hasMore: false, nextCursor: null },
    })),
    getMigrationRun: vi.fn(),
    listMigrationConflicts: vi.fn(async () => ({
      items: [],
      page: { limit: 50, hasMore: false, nextCursor: null },
    })),
    getMigrationConflict: vi.fn(),
    listAuditEvents: vi.fn(async () => ({
      items: [],
      page: { limit: 50, hasMore: false, nextCursor: null },
    })),
    readMetrics: vi.fn(async () => "crm_backend_up 1\n"),
  };
}

describe("operations plugin OpenAPI", () => {
  it("registers only authenticated GET contracts with explicit permissions", async () => {
    const app = Fastify();
    await app.register(swagger, {
      openapi: {
        info: { title: "test", version: "1" },
        components: {
          securitySchemes: {
            sessionCookie: { type: "apiKey", in: "cookie", name: "session" },
          },
        },
      },
    });
    await app.register(operationsPlugin, {
      service: serviceMock(),
      resolveActor: async (request) => ({
        userAccountId: "11111111-1111-4111-8111-111111111111",
        requestId: request.id,
      }),
    });
    await app.ready();

    const document = app.swagger() as unknown as {
      paths?: Record<string, Record<string, Record<string, unknown>>>;
    };
    for (const operation of OPERATIONS_LIST) {
      const path = operation.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
      const contract = document.paths?.[path]?.get;
      expect(contract?.operationId).toBe(operation.operationId);
      expect(contract?.["x-permission-code"]).toBe(operation.permissionCode);
      expect(contract?.security).toEqual([{ sessionCookie: [] }]);
      expect(document.paths?.[path]?.post).toBeUndefined();
      expect(document.paths?.[path]?.patch).toBeUndefined();
      expect(document.paths?.[path]?.delete).toBeUndefined();
    }
    expect(OPERATIONS_LIST.some((operation) => operation.permissionCode === "migration.run.execute")).toBe(
      false,
    );
    await app.close();
  });

  it("authenticates /metrics and serves a no-store text exposition", async () => {
    const app = Fastify();
    const resolveActor = vi.fn(async (request: { id: string }) => ({
      userAccountId: "11111111-1111-4111-8111-111111111111",
      requestId: request.id,
    }));
    const service = serviceMock();
    await app.register(operationsPlugin, { service, resolveActor });

    const response = await app.inject({ method: "GET", url: "/metrics" });
    expect(response.statusCode).toBe(200);
    expect(resolveActor).toHaveBeenCalledOnce();
    expect(service.readMetrics).toHaveBeenCalledOnce();
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.body).toBe("crm_backend_up 1\n");
    await app.close();
  });
});
