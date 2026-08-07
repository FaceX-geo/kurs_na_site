import cookie from "@fastify/cookie";
import swagger from "@fastify/swagger";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config/env.js";
import type { DatabaseHandle } from "../src/db/client.js";
import { identityAdminPlugin } from "../src/modules/identity/admin-plugin.js";
import type { IdentityAdminService } from "../src/modules/identity/admin-service.js";
import type { AuthContext, IdentityService } from "../src/modules/identity/service.js";

const apps: ReturnType<typeof Fastify>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("identity admin OpenAPI", () => {
  it("publishes only registered operation ids and keeps them unique", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    await app.register(cookie);
    await app.register(swagger, {
      openapi: {
        info: { title: "test", version: "1" },
        components: {
          securitySchemes: {
            sessionCookie: { type: "apiKey", in: "cookie", name: "session" },
            csrfToken: { type: "apiKey", in: "header", name: "x-csrf-token" },
          },
        },
      },
    });

    const config = loadConfig({
      NODE_ENV: "test",
      CURSOR_SIGNING_KEY: "test-cursor-signing-key-at-least-32-chars",
      SESSION_TOKEN_PEPPER: "test-session-token-pepper-at-least-32-chars",
      MFA_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 7).toString("base64"),
      PII_HASHING_KEY: "test-pii-hashing-key-at-least-32-chars",
    });
    await app.register(identityAdminPlugin, {
      config,
      database: { db: null } as unknown as DatabaseHandle,
      authService: {} as IdentityService,
      service: {} as IdentityAdminService,
    });
    await app.ready();

    const document = app.swagger() as {
      paths: Record<string, Record<string, { operationId?: string }>>;
    };
    const operationIds = Object.values(document.paths).flatMap((path) =>
      Object.values(path).flatMap((operation) => (operation.operationId ? [operation.operationId] : [])),
    );
    expect(operationIds).toHaveLength(35);
    expect(new Set(operationIds).size).toBe(operationIds.length);
    expect(operationIds).toEqual(
      expect.arrayContaining([
        "AcceptInvite",
        "CompletePasswordReset",
        "EnrollMfa",
        "ChangeOwnPassword",
        "InviteUser",
        "ListProvisionableEmployees",
        "ProvisionSpecialist",
        "ListUsers",
        "GetUser",
        "PreviewEffectiveAccess",
        "AssignPlatformRole",
        "AssignCrmRole",
        "RevokeCrmRole",
        "AssignProjectRole",
        "RevokeProjectRole",
        "AssignInitialCrmAdmin",
        "AssignInitialProjectAdmin",
        "AssignCrmAdminRole",
        "AssignProjectAdminRole",
        "RevokePlatformRole",
        "RevokeCrmAdminRole",
        "RevokeProjectAdminRole",
        "AssignMigrationRole",
        "RevokeMigrationRole",
        "AssignAuditRole",
        "RevokeAuditRole",
        "EnableUser",
        "DisableUser",
        "ArchiveUser",
        "RequestAdminPasswordReset",
        "ResetUserMfa",
        "ListUserSessions",
        "RevokeUserSessions",
        "ListApprovalRequests",
        "ApproveOrRejectCriticalOperation",
      ]),
    );

    const crmAssign = document.paths["/internal/v1/admin/users/{userId}/roles/crm/assign"]?.post as
      | {
          "x-permission-code"?: string;
          requestBody?: { content?: { "application/json"?: { schema?: { required?: string[] } } } };
        }
      | undefined;
    expect(crmAssign?.["x-permission-code"]).toBe("identity.roles.assign_crm");
    expect(crmAssign?.requestBody?.content?.["application/json"]?.schema?.required).toEqual(
      expect.arrayContaining(["roleCode", "scopeType", "expectedVersion", "reason", "previewFingerprint"]),
    );

    const platformAssign = document.paths["/internal/v1/admin/users/{userId}/roles/platform/assign"]?.post as
      | {
          requestBody?: {
            content?: { "application/json"?: { schema?: { properties?: Record<string, unknown> } } };
          };
        }
      | undefined;
    expect(platformAssign?.requestBody?.content?.["application/json"]?.schema?.properties).not.toHaveProperty(
      "roleCode",
    );

    const initialCrmAdmin = document.paths["/internal/v1/admin/users/{userId}/roles/crm-admin/initial/assign"]
      ?.post as
      | { requestBody?: { content?: { "application/json"?: { schema?: { required?: string[] } } } } }
      | undefined;
    expect(initialCrmAdmin?.requestBody?.content?.["application/json"]?.schema?.required).toContain(
      "nominationRef",
    );

    const projectRevoke = document.paths["/internal/v1/admin/users/{userId}/roles/project/revoke"]?.post as
      | { requestBody?: { content?: { "application/json"?: { schema?: { required?: string[] } } } } }
      | undefined;
    expect(projectRevoke?.requestBody?.content?.["application/json"]?.schema?.required).toContain(
      "transferRef",
    );

    const userSessions = document.paths["/internal/v1/admin/users/{userId}/sessions"]?.get as
      | {
          parameters?: Array<{ in?: string; name?: string }>;
          responses?: Record<string, unknown>;
        }
      | undefined;
    expect(userSessions?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ in: "query", name: "reason" }),
        expect.objectContaining({ in: "query", name: "cursor" }),
        expect.objectContaining({ in: "query", name: "limit" }),
      ]),
    );
    expect(userSessions?.responses).toHaveProperty("422");

    const employees = document.paths["/internal/v1/admin/employees"]?.get as
      | {
          "x-permission-code"?: string;
          security?: Array<Record<string, string[]>>;
          parameters?: Array<{ in?: string; name?: string }>;
        }
      | undefined;
    expect(employees?.["x-permission-code"]).toBe("identity.employees.read");
    expect(employees?.security).toEqual([{ sessionCookie: [] }]);
    expect(employees?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ in: "query", name: "cursor" }),
        expect.objectContaining({ in: "query", name: "limit" }),
      ]),
    );

    const provision = document.paths["/internal/v1/admin/specialists"]?.post as
      | {
          "x-permission-code"?: string;
          security?: Array<Record<string, string[]>>;
          parameters?: Array<{ in?: string; name?: string; required?: boolean }>;
          requestBody?: { content?: { "application/json"?: { schema?: { required?: string[] } } } };
          responses?: Record<
            string,
            {
              headers?: Record<string, unknown>;
              content?: {
                "application/json"?: { schema?: { properties?: Record<string, unknown> } };
              };
            }
          >;
        }
      | undefined;
    expect(provision?.["x-permission-code"]).toBe("identity.specialists.provision");
    expect(provision?.security).toEqual([{ sessionCookie: [], csrfToken: [] }]);
    expect(provision?.requestBody?.content?.["application/json"]?.schema?.required).toEqual(
      expect.arrayContaining(["employeeProfileId", "email", "reason"]),
    );
    expect(provision?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          in: "header",
          name: "idempotency-key",
          required: true,
        }),
      ]),
    );
    expect(provision?.responses).toHaveProperty("404");
    expect(provision?.responses).toHaveProperty("409");
    expect(provision?.responses?.["202"]?.headers).toHaveProperty("Idempotency-Replayed");
    expect(provision?.responses?.["202"]?.content?.["application/json"]?.schema?.properties).toEqual(
      expect.objectContaining({
        auditEventId: expect.any(Object),
        operationId: expect.any(Object),
        requestId: expect.any(Object),
        occurredAt: expect.any(Object),
        credentialDelivery: expect.any(Object),
      }),
    );
  });

  it("requires the provisioning key and marks an exact stored-receipt replay", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    await app.register(cookie);
    const config = loadConfig({
      NODE_ENV: "test",
      CURSOR_SIGNING_KEY: "specialist-route-cursor-key-at-least-32-chars",
      SESSION_TOKEN_PEPPER: "specialist-route-session-pepper-at-least-32-chars",
    });
    const context: AuthContext = {
      sessionId: "019fd7d0-6789-7000-8000-000000000001",
      userAccountId: "019fd7d0-6789-7000-8000-000000000002",
      personId: "019fd7d0-6789-7000-8000-000000000003",
      email: "admin@example.test",
      authenticationLevel: "fresh_mfa",
      csrfTokenHash: "a".repeat(64),
      roles: ["platform_superadmin"],
      permissions: ["identity.specialists.provision"],
      businessRole: "SUPER_ADMIN",
      employeeProfileId: null,
    };
    const authService = {
      authenticate: vi.fn(async () => context),
      assertTrustedMutation: vi.fn(),
    } as unknown as IdentityService;
    const receipt = {
      id: "019fd7d0-6789-7000-8000-000000000010",
      auditEventId: "019fd7d0-6789-7000-8000-000000000010",
      operationId: "ProvisionSpecialist" as const,
      requestId: "original-request-id",
      userId: "019fd7d0-6789-7000-8000-000000000011",
      employeeProfileId: "019fd7d0-6789-7000-8000-000000000012",
      businessRole: "SPECIALIST" as const,
      expiresAt: "2026-08-09T00:00:00.000Z",
      occurredAt: "2026-08-07T00:00:00.000Z",
      credentialDelivery: "queued_internal" as const,
    };
    const provisionSpecialist = vi.fn(async () => ({ receipt, replayed: true }));
    await app.register(identityAdminPlugin, {
      config,
      database: { db: null } as unknown as DatabaseHandle,
      authService,
      service: { provisionSpecialist } as unknown as IdentityAdminService,
    });

    const missingKey = await app.inject({
      method: "POST",
      url: "/internal/v1/admin/specialists",
      headers: { "x-csrf-token": "c".repeat(32) },
      payload: {
        employeeProfileId: receipt.employeeProfileId,
        email: "specialist@example.test",
        reason: "Создание специалиста из БД",
      },
    });
    expect(missingKey.statusCode).toBe(400);
    expect(provisionSpecialist).not.toHaveBeenCalled();

    const replay = await app.inject({
      method: "POST",
      url: "/internal/v1/admin/specialists",
      headers: {
        "x-csrf-token": "c".repeat(32),
        "idempotency-key": "specialist-provision-route-0001",
      },
      payload: {
        employeeProfileId: receipt.employeeProfileId,
        email: "specialist@example.test",
        reason: "Создание специалиста из БД",
      },
    });
    expect(replay.statusCode).toBe(202);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(replay.json()).toEqual(receipt);
    expect(provisionSpecialist).toHaveBeenCalledWith(
      context,
      expect.objectContaining({ employeeProfileId: receipt.employeeProfileId }),
      "specialist-provision-route-0001",
      expect.objectContaining({ requestId: expect.any(String) }),
    );
  });
});
