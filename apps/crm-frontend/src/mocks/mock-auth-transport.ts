import { createMockAuthenticatedResponse, createMockOwnProfile } from "@/mocks/auth-fixtures";
import type {
  AuthApiTransport,
  AuthenticatedResponse,
  EnrollMfaRequest,
  EnrollMfaResponse,
  LoginRequest,
  LoginResponse,
  OwnProfileResponse,
  VerifyMfaRequest,
  VerifyMfaResponse,
} from "@/shared/api/contracts";
import { csrfTokenStore } from "@/shared/api/csrf";
import { ApiError } from "@/shared/api/errors";
import { createIdempotencyKey } from "@/shared/api/request-descriptor";

interface MockAuthTransportOptions {
  initiallyAuthenticated?: boolean;
}

function assertSixDigits(value: string): void {
  if (!/^\d{6}$/.test(value)) {
    throw new ApiError("MOCK_CODE_INVALID", "Для тестового подтверждения введите 6 цифр.", {
      status: 422,
    });
  }
}

export function createMockAuthTransport(options: MockAuthTransportOptions = {}): AuthApiTransport {
  let authenticated = options.initiallyAuthenticated ?? false;
  let authenticationLevel: "mfa" | "fresh_mfa" = "mfa";
  let activeChallenge: { id: string; token: string } | null = null;

  function completeAuthentication(): AuthenticatedResponse {
    const response = createMockAuthenticatedResponse();
    authenticated = true;
    authenticationLevel = "mfa";
    activeChallenge = null;
    csrfTokenStore.write(response.csrfToken);
    return response;
  }

  return {
    mode: "mock",

    async getOwnProfile(): Promise<OwnProfileResponse | null> {
      return authenticated ? createMockOwnProfile(authenticationLevel) : null;
    },

    async refreshCsrfToken() {
      if (!authenticated) {
        throw new ApiError("MOCK_SESSION_REQUIRED", "Сначала войдите в CRM.", { status: 401 });
      }
      const response = { csrfToken: "mock-refreshed-csrf-token-not-for-production" };
      csrfTokenStore.write(response.csrfToken);
      return response;
    },

    async login(input: LoginRequest): Promise<LoginResponse> {
      if (!input.login.trim() || !input.password) {
        throw new ApiError("MOCK_CREDENTIALS_REQUIRED", "Укажите логин и пароль.", {
          status: 422,
        });
      }

      authenticated = false;
      csrfTokenStore.clear();
      activeChallenge = {
        id: `mock-challenge-${createIdempotencyKey()}`,
        token: `mock-token-${createIdempotencyKey()}`,
      };

      return {
        status: "mfa_required",
        challengeId: activeChallenge.id,
        challengeToken: activeChallenge.token,
        provider: "max_otp",
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      };
    },

    async verifyMfa(input: VerifyMfaRequest): Promise<VerifyMfaResponse> {
      if ("password" in input) {
        if (!authenticated) {
          throw new ApiError("MOCK_SESSION_REQUIRED", "Сначала войдите в CRM.", {
            status: 401,
          });
        }
        if (!input.password) {
          throw new ApiError("MOCK_PASSWORD_REQUIRED", "Введите пароль.", { status: 422 });
        }
        assertSixDigits(input.mfaCode);
        const response = createMockAuthenticatedResponse();
        authenticationLevel = "fresh_mfa";
        csrfTokenStore.write(response.csrfToken);
        return response;
      }

      if (!("challengeId" in input) || !("challengeToken" in input)) {
        throw new ApiError(
          "MOCK_REAUTH_UNSUPPORTED",
          "Повторная аутентификация не входит в тестовый сценарий.",
          { status: 422 },
        );
      }

      if (
        !activeChallenge ||
        input.challengeId !== activeChallenge.id ||
        input.challengeToken !== activeChallenge.token
      ) {
        throw new ApiError(
          "MOCK_CHALLENGE_EXPIRED",
          "Тестовый запрос устарел. Начните вход заново.",
          {
            status: 410,
          },
        );
      }

      if ("code" in input) assertSixDigits(input.code);
      if ("recoveryCode" in input && !input.recoveryCode.trim()) {
        throw new ApiError("MOCK_RECOVERY_REQUIRED", "Введите тестовый код восстановления.", {
          status: 422,
        });
      }

      return completeAuthentication();
    },

    async enrollMfa(input: EnrollMfaRequest): Promise<EnrollMfaResponse> {
      if (input.action === "start") {
        activeChallenge = { id: input.challengeId, token: input.challengeToken };
        return {
          status: "enrollment_started",
          secret: "mock-placeholder-not-a-real-secret",
          uri: "mock://max-enrollment-placeholder",
          expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        };
      }

      assertSixDigits(input.code);
      return {
        ...completeAuthentication(),
        recoveryCodes: ["MOCK-RECOVERY-PLACEHOLDER"],
      };
    },

    async logout(): Promise<void> {
      authenticated = false;
      authenticationLevel = "mfa";
      activeChallenge = null;
      csrfTokenStore.clear();
    },

    async instantSignIn(): Promise<AuthenticatedResponse> {
      return completeAuthentication();
    },
  } satisfies AuthApiTransport;
}
