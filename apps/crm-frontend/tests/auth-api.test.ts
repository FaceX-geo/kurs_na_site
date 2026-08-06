// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockAuthTransport } from "@/mocks/mock-auth-transport";
import { csrfTokenStore } from "@/shared/api/csrf";
import { normalizeApiError } from "@/shared/api/errors";
import { createLiveAuthTransport } from "@/shared/api/live-auth-transport";
import { buildMutationHeaders, createIdempotencyKey } from "@/shared/api/request-descriptor";
import { resolveAuthMode } from "@/shared/auth";

describe("auth API contracts", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    csrfTokenStore.clear();
  });

  it("defaults development to mock and production to live", () => {
    expect(resolveAuthMode({ PROD: false })).toBe("mock");
    expect(resolveAuthMode({ PROD: true })).toBe("live");
    expect(() => resolveAuthMode({ PROD: true, VITE_CRM_AUTH_MODE: "mock" })).toThrow("запрещена");
  });

  it("builds explicit CSRF, idempotency and ETag mutation headers", () => {
    csrfTokenStore.write("csrf-for-this-tab");
    const idempotencyKey = createIdempotencyKey();

    expect(
      buildMutationHeaders({
        csrf: "required",
        idempotencyKey,
        ifMatch: '"person-v7"',
      }),
    ).toEqual({
      "idempotency-key": idempotencyKey,
      "if-match": '"person-v7"',
      "x-csrf-token": "csrf-for-this-tab",
    });
  });

  it("keeps the MAX mock local and accepts the documented six-digit test flow", async () => {
    const transport = createMockAuthTransport();
    const challenge = await transport.login({ login: "tester@example.test", password: "test" });
    expect(challenge.status).toBe("mfa_required");

    if (challenge.status !== "mfa_required") throw new Error("Expected mock MFA challenge");
    const session = await transport.verifyMfa({
      challengeId: challenge.challengeId,
      challengeToken: challenge.challengeToken,
      code: "123456",
    });

    expect(session.status).toBe("authenticated");
    await expect(transport.getOwnProfile()).resolves.toMatchObject({
      authenticationLevel: "mfa",
    });
  });

  it("normalizes backend error envelopes without losing request evidence", () => {
    const error = normalizeApiError(
      {
        code: "AUTH_DENIED",
        message: "Доступ не подтверждён.",
        requestId: "request-42",
        details: { factor: "max_otp" },
      },
      new Response(null, { status: 403 }),
    );

    expect(error).toMatchObject({
      code: "AUTH_DENIED",
      message: "Доступ не подтверждён.",
      requestId: "request-42",
      status: 403,
      details: { factor: "max_otp" },
    });
  });

  it("uses credentialed live requests and sends CSRF on reauth and logout", async () => {
    const requests: Request[] = [];
    const fetch = vi.fn(async (request: Request) => {
      requests.push(request);
      if (request.url.endsWith("/auth/logout")) return new Response(null, { status: 204 });

      return Response.json({
        status: "authenticated",
        csrfToken: "live-csrf",
        expiresAt: "2026-08-06T16:00:00.000Z",
        user: {
          id: "00000000-0000-4000-8000-000000000201",
          email: "live@example.test",
          displayName: "Live User",
          roles: ["operator"],
        },
      });
    });
    const transport = createLiveAuthTransport({ baseUrl: "https://crm.example.test", fetch });

    await transport.login({ login: "live@example.test", password: "not-stored" });
    await transport.verifyMfa({ password: "not-stored", mfaCode: "123456" });
    await transport.logout();

    expect(requests).toHaveLength(3);
    expect(requests[0]?.credentials).toBe("include");
    expect(requests[1]?.headers.get("x-csrf-token")).toBe("live-csrf");
    expect(requests[2]?.headers.get("x-csrf-token")).toBe("live-csrf");
    expect(csrfTokenStore.read()).toBeNull();
  });
});
