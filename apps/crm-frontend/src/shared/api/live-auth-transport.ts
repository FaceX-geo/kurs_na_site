import { createCrmApiClient } from "@/shared/api/client";
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
import { normalizeApiError } from "@/shared/api/errors";
import { buildMutationHeaders } from "@/shared/api/request-descriptor";

interface LiveAuthTransportOptions {
  baseUrl?: string;
  fetch?: (request: Request) => Promise<Response>;
}

export function createLiveAuthTransport(options: LiveAuthTransportOptions = {}): AuthApiTransport {
  const client = createCrmApiClient(options);

  return {
    mode: "live",

    async getOwnProfile(): Promise<OwnProfileResponse | null> {
      try {
        const result = await client.GET("/internal/v1/auth/session");
        if (result.response.status === 401) {
          csrfTokenStore.clear();
          return null;
        }
        if (result.error !== undefined) throw normalizeApiError(result.error, result.response);
        return result.data as OwnProfileResponse;
      } catch (error) {
        throw normalizeApiError(error);
      }
    },

    async refreshCsrfToken() {
      try {
        const result = await client.POST("/internal/v1/auth/csrf/refresh");
        if (result.error !== undefined) throw normalizeApiError(result.error, result.response);
        const response = result.data;
        if (!response) throw new Error("CSRF refresh response is empty");
        csrfTokenStore.write(response.csrfToken);
        return response;
      } catch (error) {
        csrfTokenStore.clear();
        throw normalizeApiError(error);
      }
    },

    async login(input: LoginRequest): Promise<LoginResponse> {
      try {
        csrfTokenStore.clear();
        const result = await client.POST("/internal/v1/auth/login", { body: input });
        if (result.error !== undefined) throw normalizeApiError(result.error, result.response);
        const response = result.data as LoginResponse;
        if (response.status === "authenticated") csrfTokenStore.write(response.csrfToken);
        return response;
      } catch (error) {
        throw normalizeApiError(error);
      }
    },

    async verifyMfa(input: VerifyMfaRequest): Promise<VerifyMfaResponse> {
      try {
        const csrfToken =
          "password" in input
            ? buildMutationHeaders({ csrf: "required" })["x-csrf-token"]
            : undefined;
        if ("password" in input && !csrfToken) throw new Error("CSRF header invariant failed");
        const result = await client.POST("/internal/v1/auth/mfa/verify", {
          body: input,
          ...(csrfToken ? { params: { header: { "x-csrf-token": csrfToken } } } : {}),
        });
        if (result.error !== undefined) throw normalizeApiError(result.error, result.response);
        const response = result.data as VerifyMfaResponse;
        csrfTokenStore.write(response.csrfToken);
        return response;
      } catch (error) {
        throw normalizeApiError(error);
      }
    },

    async enrollMfa(input: EnrollMfaRequest): Promise<EnrollMfaResponse> {
      try {
        const result = await client.POST("/internal/v1/auth/mfa/enrollment", { body: input });
        if (result.error !== undefined) throw normalizeApiError(result.error, result.response);
        const response = result.data as EnrollMfaResponse;
        if (response.status === "authenticated") csrfTokenStore.write(response.csrfToken);
        return response;
      } catch (error) {
        throw normalizeApiError(error);
      }
    },

    async logout(): Promise<void> {
      try {
        const headers = buildMutationHeaders({ csrf: "required" });
        const csrfToken = headers["x-csrf-token"];
        if (!csrfToken) throw new Error("CSRF header invariant failed");
        const result = await client.POST("/internal/v1/auth/logout", {
          params: { header: { "x-csrf-token": csrfToken } },
        });
        if (result.error !== undefined) throw normalizeApiError(result.error, result.response);
        csrfTokenStore.clear();
      } catch (error) {
        throw normalizeApiError(error);
      }
    },
  } satisfies AuthApiTransport;
}

export type { AuthenticatedResponse };
