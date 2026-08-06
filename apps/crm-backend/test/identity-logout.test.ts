import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config/env.js";
import type { DatabaseHandle } from "../src/db/client.js";
import { identityPlugin } from "../src/modules/identity/plugin.js";
import type { AuthContext, IdentityService } from "../src/modules/identity/service.js";

const apps: ReturnType<typeof Fastify>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("identity logout", () => {
  it("revokes only the authenticated session and clears the scoped cookie", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    await app.register(cookie);
    const config = loadConfig({
      NODE_ENV: "test",
      PUBLIC_ORIGINS: "https://crm.example.test",
      SESSION_TOKEN_PEPPER: "logout-test-pepper-with-at-least-32-chars",
    });
    const context: AuthContext = {
      sessionId: "019fd7d0-6789-7000-8000-000000000001",
      userAccountId: "019fd7d0-6789-7000-8000-000000000002",
      personId: "019fd7d0-6789-7000-8000-000000000003",
      email: "user@example.test",
      authenticationLevel: "password",
      csrfTokenHash: "a".repeat(64),
      roles: [],
      permissions: [],
      businessRole: null,
      employeeProfileId: null,
    };
    const authenticate = vi.fn(async () => context);
    const assertTrustedMutation = vi.fn();
    const logoutCurrentSession = vi.fn(async () => undefined);
    const service = {
      authenticate,
      assertTrustedMutation,
      logoutCurrentSession,
    } as unknown as IdentityService;
    await app.register(identityPlugin, {
      config,
      database: { db: null } as unknown as DatabaseHandle,
      service,
    });

    const response = await app.inject({
      method: "POST",
      url: "/internal/v1/auth/logout",
      headers: {
        cookie: `${config.session.cookieName}=opaque-session-token`,
        origin: "https://crm.example.test",
        "x-csrf-token": "csrf-token-with-enough-entropy-for-test",
      },
    });

    expect(response.statusCode).toBe(204);
    expect(authenticate).toHaveBeenCalledOnce();
    expect(assertTrustedMutation).toHaveBeenCalledWith(
      expect.anything(),
      context,
      "csrf-token-with-enough-entropy-for-test",
    );
    expect(logoutCurrentSession).toHaveBeenCalledWith(context);
    expect(response.headers["set-cookie"]).toContain(`${config.session.cookieName}=;`);
    expect(response.headers["set-cookie"]).toContain("Path=/internal/v1");
  });
});
