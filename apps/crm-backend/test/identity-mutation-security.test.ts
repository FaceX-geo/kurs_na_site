import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import type { Database } from "../src/db/types.js";
import { keyedHash } from "../src/modules/identity/crypto.js";
import { type AuthContext, IdentityService } from "../src/modules/identity/service.js";

const config = loadConfig({
  NODE_ENV: "test",
  PUBLIC_ORIGINS: "https://crm.example.test",
  SESSION_TOKEN_PEPPER: "identity-mutation-test-pepper",
});
const service = new IdentityService({} as never as import("kysely").Kysely<Database>, config);
const csrfToken = "csrf-token-with-enough-entropy-for-test";
const context: AuthContext = {
  sessionId: "019fd7d0-6789-7000-8000-000000000001",
  userAccountId: "019fd7d0-6789-7000-8000-000000000002",
  personId: "019fd7d0-6789-7000-8000-000000000003",
  email: "user@example.test",
  authenticationLevel: "password",
  csrfTokenHash: keyedHash(csrfToken, config.session.tokenPepper),
  roles: ["crm_project_manager"],
  permissions: ["crm.case.transition"],
};

function request(origin: string): FastifyRequest {
  return { headers: { origin } } as FastifyRequest;
}

describe("cookie-authenticated mutation perimeter", () => {
  it("requires both a trusted origin and a valid CSRF token", () => {
    expect(() =>
      service.assertTrustedMutation(request("https://crm.example.test"), context, csrfToken),
    ).not.toThrow();

    expect(() =>
      service.assertTrustedMutation(request("https://evil.example"), context, csrfToken),
    ).toThrowError(expect.objectContaining({ statusCode: 403, code: "origin_not_trusted" }));

    expect(() =>
      service.assertTrustedMutation(request("https://crm.example.test"), context, "wrong-token"),
    ).toThrowError(expect.objectContaining({ statusCode: 403, code: "csrf_invalid" }));
  });
});
