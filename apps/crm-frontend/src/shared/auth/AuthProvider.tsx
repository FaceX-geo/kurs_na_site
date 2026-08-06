import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createMockAuthTransport } from "@/mocks/mock-auth-transport";
import type {
  AuthApiTransport,
  AuthenticatedResponse,
  LoginPendingResponse,
  OwnProfileResponse,
} from "@/shared/api/contracts";
import { csrfTokenStore } from "@/shared/api/csrf";
import { ApiError, normalizeApiError } from "@/shared/api/errors";
import { createLiveAuthTransport } from "@/shared/api/live-auth-transport";
import { isManualAuthRequested, setManualAuthRequested } from "@/shared/auth/manual-auth";
import { resolveAuthMode } from "@/shared/auth/mode";
import {
  resolveBusinessRole,
  resolveEmployeeProfileId,
  resolveScopeVisibility,
} from "@/shared/auth/policy";
import type {
  AuthContextValue,
  AuthMode,
  AuthProviderProps,
  AuthSession,
} from "@/shared/auth/types";

const AuthContext = createContext<AuthContextValue | null>(null);

type ExtendedOwnProfile = OwnProfileResponse & {
  businessRole?: unknown;
  displayName?: unknown;
  employeeProfileId?: unknown;
  scopeVisibility?: unknown;
};

function roleLabel(role: AuthSession["businessRole"]): string {
  if (role === "SUPER_ADMIN") return "Супер-администратор";
  if (role === "SPECIALIST") return "Специалист";
  return "Доступ не назначен";
}

function sessionFromProfile(
  profileResponse: OwnProfileResponse,
  authenticated?: AuthenticatedResponse,
  mutationAccess: AuthSession["mutationAccess"] = csrfTokenStore.read()
    ? "ready"
    : "reauth_required",
): AuthSession {
  const profile = profileResponse as ExtendedOwnProfile;
  const businessRole = resolveBusinessRole(profile);
  const employeeProfileId = resolveEmployeeProfileId(profile);
  const scopeVisibility = resolveScopeVisibility(profile);
  const authenticatedDisplayName = authenticated?.user.displayName;
  const displayName =
    (typeof profile.displayName === "string" && profile.displayName.trim()
      ? profile.displayName
      : authenticatedDisplayName) ??
    profile.email.split("@")[0] ??
    profile.email;
  return {
    authenticationLevel: profile.authenticationLevel,
    businessRole,
    displayName,
    ...(authenticated?.expiresAt ? { expiresAt: authenticated.expiresAt } : {}),
    roleLabel: roleLabel(businessRole),
    mutationAccess,
    scopeVisibility,
    user: {
      businessRole,
      id: profile.userAccountId,
      email: profile.email,
      displayName,
      employeeProfileId,
      roles: [...profile.roles],
      permissions: [...profile.permissions],
    },
  };
}

function createDefaultTransport(mode: AuthMode): AuthApiTransport {
  return mode === "mock" ? createMockAuthTransport() : createLiveAuthTransport();
}

export function AuthProvider({
  autoAuthenticate = true,
  children,
  mode: explicitMode,
  transport: explicitTransport,
}: AuthProviderProps) {
  const environmentMode = resolveAuthMode();
  const authMode = explicitMode ?? environmentMode;
  if (import.meta.env.PROD && authMode === "mock") {
    throw new ApiError(
      "MOCK_AUTH_FORBIDDEN",
      "Тестовая авторизация запрещена в production-сборке.",
    );
  }
  const transport = useMemo(
    () => explicitTransport ?? createDefaultTransport(authMode),
    [authMode, explicitTransport],
  );

  if (transport.mode !== authMode) {
    throw new ApiError(
      "AUTH_TRANSPORT_MODE_MISMATCH",
      `AuthProvider работает в режиме ${authMode}, а transport — ${transport.mode}.`,
    );
  }

  const [status, setStatus] = useState<AuthContextValue["status"]>("loading");
  const [session, setSession] = useState<AuthSession | null>(null);
  const [pendingAuth, setPendingAuth] = useState<LoginPendingResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const completeAuthentication = useCallback(
    async (response: AuthenticatedResponse) => {
      csrfTokenStore.write(response.csrfToken);
      const profile = await transport.getOwnProfile();
      if (!profile) {
        csrfTokenStore.clear();
        throw new ApiError(
          "AUTH_PROFILE_REFRESH_FAILED",
          "Сеанс создан, но сервер не подтвердил профиль и права. Войдите заново.",
          { status: 401 },
        );
      }
      setManualAuthRequested(false);
      setSession(sessionFromProfile(profile, response, "ready"));
      setPendingAuth(null);
      setError(null);
      setStatus("authenticated");
    },
    [transport],
  );

  useEffect(() => {
    let active = true;

    async function bootstrap(): Promise<void> {
      try {
        if (authMode === "mock" && isManualAuthRequested()) {
          if (active) setStatus("anonymous");
          return;
        }

        if (authMode === "mock" && autoAuthenticate && transport.instantSignIn) {
          const response = await transport.instantSignIn();
          if (active) await completeAuthentication(response);
          return;
        }

        const profile = await transport.getOwnProfile();
        if (!active) return;

        if (profile) {
          let mutationAccess: AuthSession["mutationAccess"] = csrfTokenStore.read()
            ? "ready"
            : "reauth_required";
          if (mutationAccess === "reauth_required") {
            try {
              await transport.refreshCsrfToken();
              mutationAccess = "ready";
            } catch {
              csrfTokenStore.clear();
            }
          }
          if (!active) return;
          setSession(sessionFromProfile(profile, undefined, mutationAccess));
          setStatus("authenticated");
        } else {
          setSession(null);
          setStatus("anonymous");
        }
      } catch (caught) {
        if (!active) return;
        setError(normalizeApiError(caught));
        setSession(null);
        setStatus("anonymous");
      }
    }

    void bootstrap();
    return () => {
      active = false;
    };
  }, [authMode, autoAuthenticate, completeAuthentication, transport]);

  const enterManualAuth = useCallback(() => {
    setManualAuthRequested(true);
    csrfTokenStore.clear();
    setPendingAuth(null);
    setSession(null);
    setError(null);
    setStatus("anonymous");
    void transport.logout().catch(() => undefined);
  }, [transport]);

  const instantSignIn = useCallback(async () => {
    if (authMode !== "mock" || !transport.instantSignIn) {
      throw new ApiError(
        "TEST_SIGN_IN_UNAVAILABLE",
        "Мгновенный тестовый вход доступен только в mock-режиме.",
      );
    }

    setStatus("loading");
    try {
      await completeAuthentication(await transport.instantSignIn());
    } catch (caught) {
      const normalized = normalizeApiError(caught);
      setError(normalized);
      setStatus("anonymous");
      throw normalized;
    }
  }, [authMode, completeAuthentication, transport]);

  const signInWithPassword = useCallback<AuthContextValue["signInWithPassword"]>(
    async (input) => {
      setError(null);
      try {
        const response = await transport.login(input);
        if (response.status === "authenticated") {
          await completeAuthentication(response);
          return null;
        }

        setPendingAuth(response);
        setStatus("anonymous");
        return response;
      } catch (caught) {
        const normalized = normalizeApiError(caught);
        csrfTokenStore.clear();
        setSession(null);
        setStatus("anonymous");
        setError(normalized);
        throw normalized;
      }
    },
    [completeAuthentication, transport],
  );

  const verifyMax = useCallback(
    async (code: string) => {
      if (pendingAuth?.status !== "mfa_required") {
        throw new ApiError("AUTH_CHALLENGE_MISSING", "Сначала подтвердите логин и пароль.");
      }

      try {
        const response = await transport.verifyMfa({
          challengeId: pendingAuth.challengeId,
          challengeToken: pendingAuth.challengeToken,
          code,
        });
        await completeAuthentication(response);
      } catch (caught) {
        const normalized = normalizeApiError(caught);
        setError(normalized);
        throw normalized;
      }
    },
    [completeAuthentication, pendingAuth, transport],
  );

  const recoverMax = useCallback(
    async (recoveryCode: string) => {
      if (pendingAuth?.status !== "mfa_required") {
        throw new ApiError("AUTH_CHALLENGE_MISSING", "Сначала начните вход заново.");
      }

      try {
        const response = await transport.verifyMfa({
          challengeId: pendingAuth.challengeId,
          challengeToken: pendingAuth.challengeToken,
          recoveryCode,
        });
        await completeAuthentication(response);
      } catch (caught) {
        const normalized = normalizeApiError(caught);
        setError(normalized);
        throw normalized;
      }
    },
    [completeAuthentication, pendingAuth, transport],
  );

  const reauthenticate = useCallback(
    async (password: string, mfaCode: string) => {
      if (!session) {
        throw new ApiError("AUTH_SESSION_REQUIRED", "Сначала войдите в CRM.", { status: 401 });
      }

      try {
        const response = await transport.verifyMfa({ password, mfaCode });
        await completeAuthentication(response);
      } catch (caught) {
        const normalized = normalizeApiError(caught);
        setError(normalized);
        throw normalized;
      }
    },
    [completeAuthentication, session, transport],
  );

  const enrollmentChallenge = useCallback(() => {
    if (pendingAuth?.status === "mfa_enrollment_required") return pendingAuth;
    if (authMode === "mock") {
      return {
        challengeId: "mock-enrollment-challenge",
        challengeToken: "mock-enrollment-token",
      };
    }
    throw new ApiError(
      "MFA_ENROLLMENT_CHALLENGE_MISSING",
      "Сначала подтвердите логин и пароль, чтобы начать привязку второго фактора.",
      { status: 401 },
    );
  }, [authMode, pendingAuth]);

  const startMfaEnrollment = useCallback(async () => {
    const challenge = enrollmentChallenge();
    try {
      const response = await transport.enrollMfa({
        action: "start",
        challengeId: challenge.challengeId,
        challengeToken: challenge.challengeToken,
      });
      if (response.status !== "enrollment_started") {
        throw new ApiError("MFA_ENROLLMENT_START_INVALID", "Сервер не вернул ключ привязки.");
      }
      setError(null);
      return response;
    } catch (caught) {
      const normalized = normalizeApiError(caught);
      setError(normalized);
      throw normalized;
    }
  }, [enrollmentChallenge, transport]);

  const confirmMfaEnrollment = useCallback(
    async (code: string) => {
      const challenge = enrollmentChallenge();
      try {
        const response = await transport.enrollMfa({
          action: "confirm",
          challengeId: challenge.challengeId,
          challengeToken: challenge.challengeToken,
          code,
        });

        if (response.status !== "authenticated") {
          throw new ApiError("MFA_ENROLLMENT_INCOMPLETE", "Привязка второго фактора не завершена.");
        }
        const recoveryCodes = [...response.recoveryCodes];
        await completeAuthentication(response);
        return recoveryCodes;
      } catch (caught) {
        const normalized = normalizeApiError(caught);
        setError(normalized);
        throw normalized;
      }
    },
    [completeAuthentication, enrollmentChallenge, transport],
  );

  const signOut = useCallback(async () => {
    try {
      await transport.logout();
    } finally {
      csrfTokenStore.clear();
      setManualAuthRequested(authMode === "mock");
      setPendingAuth(null);
      setSession(null);
      setStatus("anonymous");
    }
  }, [authMode, transport]);

  const value = useMemo<AuthContextValue>(
    () => ({
      authMode,
      status,
      session,
      pendingAuth,
      error,
      clearError: () => setError(null),
      enterManualAuth,
      instantSignIn,
      signInWithPassword,
      verifyMax,
      recoverMax,
      reauthenticate,
      startMfaEnrollment,
      confirmMfaEnrollment,
      signOut,
    }),
    [
      authMode,
      startMfaEnrollment,
      confirmMfaEnrollment,
      enterManualAuth,
      error,
      instantSignIn,
      pendingAuth,
      recoverMax,
      reauthenticate,
      session,
      signInWithPassword,
      signOut,
      status,
      verifyMax,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
