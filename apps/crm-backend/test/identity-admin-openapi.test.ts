import cookie from "@fastify/cookie";
import swagger from "@fastify/swagger";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import type { DatabaseHandle } from "../src/db/client.js";
import { identityAdminPlugin } from "../src/modules/identity/admin-plugin.js";
import type { IdentityAdminService } from "../src/modules/identity/admin-service.js";
import type { IdentityService } from "../src/modules/identity/service.js";

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
    expect(operationIds).toHaveLength(33);
    expect(new Set(operationIds).size).toBe(operationIds.length);
    expect(operationIds).toEqual(
      expect.arrayContaining([
        "AcceptInvite",
        "CompletePasswordReset",
        "EnrollMfa",
        "ChangeOwnPassword",
        "InviteUser",
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
  });
});
