import cookie from "@fastify/cookie";
import swagger from "@fastify/swagger";
import Fastify from "fastify";
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerErrorHandling } from "../src/common/errors.js";
import { loadConfig } from "../src/config/env.js";
import type { DatabaseHandle } from "../src/db/client.js";
import type { Database } from "../src/db/types.js";
import { keyedHash } from "../src/modules/identity/crypto.js";
import { identityPlugin } from "../src/modules/identity/plugin.js";
import { type AuthContext, IdentityService } from "../src/modules/identity/service.js";

const apps: ReturnType<typeof Fastify>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("identity OpenAPI", () => {
  it("describes conditional VerifyMfa security and every runtime error branch", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    registerErrorHandling(app);
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
      CURSOR_SIGNING_KEY: "identity-openapi-cursor-key-at-least-32-chars",
      SESSION_TOKEN_PEPPER: "identity-openapi-session-pepper-at-least-32-chars",
    });
    await app.register(identityPlugin, {
      config,
      database: { db: null } as unknown as DatabaseHandle,
      service: {} as IdentityService,
    });
    await app.ready();

    const document = app.swagger() as {
      paths: Record<
        string,
        Record<
          string,
          {
            description?: string;
            security?: Array<Record<string, string[]>>;
            responses?: Record<string, unknown>;
            parameters?: Array<{ in?: string; name?: string }>;
          }
        >
      >;
    };
    const verify = document.paths["/internal/v1/auth/mfa/verify"]?.post;
    expect(verify?.security).toEqual([{}, { sessionCookie: [], csrfToken: [] }]);
    expect(verify?.description).toContain("Reauthentication branch");
    expect(verify?.description).toContain("доверенный Origin/Referer");
    expect(verify?.responses).toHaveProperty("403");
    expect(verify?.responses).toHaveProperty("503");

    const ownSessions = document.paths["/internal/v1/auth/sessions"]?.get;
    expect(ownSessions?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ in: "query", name: "cursor" }),
        expect.objectContaining({ in: "query", name: "limit" }),
      ]),
    );
    expect(ownSessions?.responses?.["200"]).toEqual(expect.objectContaining({ content: expect.any(Object) }));
  });

  it("keeps trusted-origin and CSRF enforcement on the reauthentication branch", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    registerErrorHandling(app);
    await app.register(cookie);
    const csrfToken = "csrf-token-with-enough-entropy-for-reauth";
    const config = loadConfig({
      NODE_ENV: "test",
      PUBLIC_ORIGINS: "https://crm.example.test",
      CURSOR_SIGNING_KEY: "identity-runtime-cursor-key-at-least-32-chars",
      SESSION_TOKEN_PEPPER: "identity-runtime-session-pepper-at-least-32-chars",
    });
    const service = new IdentityService({} as Kysely<Database>, config);
    const context: AuthContext = {
      sessionId: "019fd7d0-6789-7000-8000-000000000001",
      userAccountId: "019fd7d0-6789-7000-8000-000000000002",
      personId: "019fd7d0-6789-7000-8000-000000000003",
      email: "user@example.test",
      authenticationLevel: "mfa",
      csrfTokenHash: keyedHash(csrfToken, config.session.tokenPepper),
      roles: [],
      permissions: [],
    };
    vi.spyOn(service, "authenticate").mockResolvedValue(context);
    const reauthenticate = vi.spyOn(service, "reauthenticate").mockResolvedValue({
      sessionToken: "new-session-token",
      csrfToken: "new-csrf-token",
      expiresAt: "2026-08-06T16:00:00.000Z",
      user: { id: context.userAccountId, email: context.email, displayName: "Иван Иванов", roles: [] },
    });
    await app.register(identityPlugin, {
      config,
      database: { db: null } as unknown as DatabaseHandle,
      service,
    });

    const response = await app.inject({
      method: "POST",
      url: "/internal/v1/auth/mfa/verify",
      headers: {
        cookie: `${config.session.cookieName}=opaque-session-token`,
        origin: "https://evil.example",
        "x-csrf-token": csrfToken,
      },
      payload: { password: "password-with-enough-length", mfaCode: "123456" },
    });

    expect(response.statusCode).toBe(403);
    expect(reauthenticate).not.toHaveBeenCalled();
  });
});
