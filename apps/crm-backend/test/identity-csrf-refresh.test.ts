import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, registerErrorHandling } from "../src/common/errors.js";
import { loadConfig } from "../src/config/env.js";
import type { DatabaseHandle } from "../src/db/client.js";
import type { Database } from "../src/db/types.js";
import { keyedHash } from "../src/modules/identity/crypto.js";
import { identityPlugin } from "../src/modules/identity/plugin.js";
import { type AuthContext, IdentityService } from "../src/modules/identity/service.js";
import { appendAuditEvent } from "../src/modules/platform/audit.js";

vi.mock("../src/modules/platform/audit.js", () => ({
  appendAuditEvent: vi.fn(async () => "019fd7d0-6789-7000-8000-000000000099"),
}));

const apps: ReturnType<typeof Fastify>[] = [];
const config = loadConfig({
  NODE_ENV: "test",
  PUBLIC_ORIGINS: "https://crm.example.test",
  CURSOR_SIGNING_KEY: "csrf-refresh-cursor-key-at-least-32-chars",
  SESSION_TOKEN_PEPPER: "csrf-refresh-session-pepper-at-least-32-chars",
});
const oldCsrfToken = "old-csrf-token-with-enough-entropy-for-test";
const context: AuthContext = {
  sessionId: "019fd7d0-6789-7000-8000-000000000001",
  userAccountId: "019fd7d0-6789-7000-8000-000000000002",
  personId: "019fd7d0-6789-7000-8000-000000000003",
  email: "specialist@example.test",
  authenticationLevel: "password",
  csrfTokenHash: keyedHash(oldCsrfToken, config.session.tokenPepper),
  roles: ["crm_project_manager"],
  permissions: ["crm.case.list"],
  businessRole: "SPECIALIST",
  employeeProfileId: "019fd7d0-6789-7000-8000-000000000004",
};
const mockedAppendAuditEvent = vi.mocked(appendAuditEvent);

beforeEach(() => {
  mockedAppendAuditEvent.mockReset();
  mockedAppendAuditEvent.mockResolvedValue("019fd7d0-6789-7000-8000-000000000099");
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function activeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: context.sessionId,
    user_account_id: context.userAccountId,
    idle_expires_at: new Date(Date.now() + 60_000),
    absolute_expires_at: new Date(Date.now() + 3_600_000),
    revoked_at: null,
    account_state: "active",
    credential_state: "password_set",
    risk_state: "normal",
    ...overrides,
  };
}

function createRotationDatabase(session = activeSession()) {
  let persistedHash = context.csrfTokenHash;
  let transactionCalls = 0;
  let lockCalls = 0;
  let updateCalls = 0;
  const database = {
    transaction() {
      return {
        async execute<T>(callback: (transaction: unknown) => Promise<T>): Promise<T> {
          transactionCalls += 1;
          let pendingHash = persistedHash;
          const transaction = {
            selectFrom(table: string) {
              if (table !== "identity.session as session") {
                throw new Error(`Unexpected select table ${table}`);
              }
              const query = {
                innerJoin() {
                  return query;
                },
                select() {
                  return query;
                },
                where() {
                  return query;
                },
                forUpdate() {
                  lockCalls += 1;
                  return query;
                },
                async executeTakeFirst() {
                  return session;
                },
              };
              return query;
            },
            updateTable(table: string) {
              if (table !== "identity.session") {
                throw new Error(`Unexpected update table ${table}`);
              }
              const query = {
                set(values: Record<string, unknown>) {
                  pendingHash = String(values.csrf_token_hash);
                  return query;
                },
                where() {
                  return query;
                },
                async execute() {
                  updateCalls += 1;
                },
              };
              return query;
            },
          };
          const result = await callback(transaction);
          persistedHash = pendingHash;
          return result;
        },
      };
    },
  } as unknown as Kysely<Database>;
  return {
    database,
    persistedHash: () => persistedHash,
    transactionCalls: () => transactionCalls,
    lockCalls: () => lockCalls,
    updateCalls: () => updateCalls,
  };
}

async function pluginApp(service: IdentityService) {
  const app = Fastify({ logger: false });
  apps.push(app);
  registerErrorHandling(app);
  await app.register(cookie);
  await app.register(rateLimit, { global: false, keyGenerator: () => "csrf-refresh-test-client" });
  await app.register(identityPlugin, {
    config,
    database: { db: null } as unknown as DatabaseHandle,
    service,
  });
  await app.ready();
  return app;
}

describe("CSRF token refresh", () => {
  it("rotates only the keyed hash and appends a token-free audit event in one transaction", async () => {
    const fixture = createRotationDatabase();
    const service = new IdentityService(fixture.database, config);

    const receipt = await service.refreshCsrfToken(context, "request-rotation");
    expect(receipt.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(receipt.csrfToken).not.toBe(oldCsrfToken);
    expect(fixture.persistedHash()).toBe(keyedHash(receipt.csrfToken, config.session.tokenPepper));
    expect(fixture.persistedHash()).not.toContain(receipt.csrfToken);
    expect(fixture.transactionCalls()).toBe(1);
    expect(fixture.lockCalls()).toBe(1);
    expect(fixture.updateCalls()).toBe(1);

    expect(() =>
      service.assertCsrf({ ...context, csrfTokenHash: fixture.persistedHash() }, receipt.csrfToken),
    ).not.toThrow();
    expect(() =>
      service.assertCsrf({ ...context, csrfTokenHash: fixture.persistedHash() }, oldCsrfToken),
    ).toThrowError(expect.objectContaining({ code: "csrf_invalid" }));
    const auditInput = mockedAppendAuditEvent.mock.calls[0]?.[1];
    expect(auditInput).toMatchObject({
      eventType: "identity.csrf.rotated",
      actorId: context.userAccountId,
      subjectId: context.sessionId,
      requestId: "request-rotation",
    });
    expect(JSON.stringify(auditInput)).not.toContain(receipt.csrfToken);
    expect(JSON.stringify(auditInput)).not.toContain(fixture.persistedHash());
  });

  it("keeps the previous hash if the atomic audit append fails", async () => {
    const fixture = createRotationDatabase();
    mockedAppendAuditEvent.mockRejectedValueOnce(new Error("audit unavailable"));

    await expect(
      new IdentityService(fixture.database, config).refreshCsrfToken(context, "request-rollback"),
    ).rejects.toThrow("audit unavailable");
    expect(fixture.persistedHash()).toBe(context.csrfTokenHash);
  });

  it("rejects an expired locked session without rotating or auditing", async () => {
    const fixture = createRotationDatabase(activeSession({ idle_expires_at: new Date(Date.now() - 1_000) }));

    await expect(
      new IdentityService(fixture.database, config).refreshCsrfToken(context, "request-expired"),
    ).rejects.toMatchObject({ statusCode: 401, code: "session_expired" });
    expect(fixture.persistedHash()).toBe(context.csrfTokenHash);
    expect(fixture.updateCalls()).toBe(0);
    expect(mockedAppendAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects missing and evil origins before session authentication", async () => {
    const service = new IdentityService({} as Kysely<Database>, config);
    const authenticate = vi.spyOn(service, "authenticate").mockResolvedValue(context);
    const refresh = vi.spyOn(service, "refreshCsrfToken").mockResolvedValue({ csrfToken: "r".repeat(43) });
    const app = await pluginApp(service);

    for (const headers of [
      { cookie: `${config.session.cookieName}=opaque-session` },
      { cookie: `${config.session.cookieName}=opaque-session`, origin: "https://evil.example" },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/internal/v1/auth/csrf/refresh",
        headers,
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: "origin_not_trusted" });
    }
    expect(authenticate).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("returns 401 for an expired cookie session and never reaches rotation", async () => {
    const service = new IdentityService({} as Kysely<Database>, config);
    vi.spyOn(service, "authenticate").mockRejectedValue(
      new AppError(401, "session_expired", "Сессия завершена"),
    );
    const refresh = vi.spyOn(service, "refreshCsrfToken").mockResolvedValue({ csrfToken: "r".repeat(43) });
    const app = await pluginApp(service);

    const response = await app.inject({
      method: "POST",
      url: "/internal/v1/auth/csrf/refresh",
      headers: {
        cookie: `${config.session.cookieName}=expired-session`,
        origin: "https://crm.example.test",
      },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "session_expired" });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("returns a no-store token without requiring the previous CSRF header", async () => {
    const service = new IdentityService({} as Kysely<Database>, config);
    vi.spyOn(service, "authenticate").mockResolvedValue(context);
    const refresh = vi.spyOn(service, "refreshCsrfToken").mockResolvedValue({ csrfToken: "n".repeat(43) });
    const app = await pluginApp(service);

    const response = await app.inject({
      method: "POST",
      url: "/internal/v1/auth/csrf/refresh",
      headers: {
        cookie: `${config.session.cookieName}=valid-session`,
        origin: "https://crm.example.test",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ csrfToken: "n".repeat(43) });
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.headers.pragma).toBe("no-cache");
    expect(refresh).toHaveBeenCalledWith(context, expect.any(String));
  });

  it("rate-limits repeated refresh attempts", async () => {
    const service = new IdentityService({} as Kysely<Database>, config);
    vi.spyOn(service, "authenticate").mockResolvedValue(context);
    const refresh = vi.spyOn(service, "refreshCsrfToken").mockResolvedValue({ csrfToken: "q".repeat(43) });
    const app = await pluginApp(service);
    const request = {
      method: "POST" as const,
      url: "/internal/v1/auth/csrf/refresh",
      headers: {
        cookie: `${config.session.cookieName}=valid-session`,
        origin: "https://crm.example.test",
      },
    };

    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await app.inject(request)).statusCode).toBe(200);
    }
    const limited = await app.inject(request);
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ code: "rate_limit_exceeded" });
    expect(refresh).toHaveBeenCalledTimes(10);
  });
});
