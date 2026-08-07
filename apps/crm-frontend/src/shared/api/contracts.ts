import type { operations } from "@/shared/api/generated/openapi";

type JsonRequestBody<Operation> = Operation extends {
  requestBody: { content: { "application/json": infer Body } };
}
  ? Body
  : never;

type JsonResponse<Operation, Status extends number> = Operation extends {
  responses: infer Responses;
}
  ? Status extends keyof Responses
    ? Responses[Status] extends { content: { "application/json": infer Body } }
      ? Body
      : never
    : never
  : never;

export const AUTH_OPERATION_IDS = {
  acceptInvite: "AcceptInvite",
  changeOwnPassword: "ChangeOwnPassword",
  completePasswordReset: "CompletePasswordReset",
  enrollMfa: "EnrollMfa",
  getOwnProfile: "GetOwnProfile",
  listOwnSessions: "ListOwnSessions",
  login: "Login",
  logout: "Logout",
  refreshCsrfToken: "RefreshCsrfToken",
  revokeOwnSession: "RevokeOwnSession",
  verifyMfa: "VerifyMfa",
} as const satisfies Record<string, keyof operations>;

export type AuthOperationAlias = keyof typeof AUTH_OPERATION_IDS;
export type AuthOperationId = (typeof AUTH_OPERATION_IDS)[AuthOperationAlias];

export type LoginRequest = JsonRequestBody<operations["Login"]>;
export type AuthenticatedResponse = JsonResponse<operations["Login"], 200>;
export type LoginPendingResponse = JsonResponse<operations["Login"], 202>;
export type LoginResponse = AuthenticatedResponse | LoginPendingResponse;

export type VerifyMfaRequest = JsonRequestBody<operations["VerifyMfa"]>;
export type VerifyMfaResponse = JsonResponse<operations["VerifyMfa"], 200>;
export type ReauthenticateRequest = Extract<VerifyMfaRequest, { password: string }>;

export type OwnProfileResponse = JsonResponse<operations["GetOwnProfile"], 200>;
export type OwnSessionsResponse = JsonResponse<operations["ListOwnSessions"], 200>;
export type RefreshCsrfTokenResponse = JsonResponse<operations["RefreshCsrfToken"], 200>;

export type EnrollMfaRequest = JsonRequestBody<operations["EnrollMfa"]>;
export type EnrollMfaResponse = JsonResponse<operations["EnrollMfa"], 200>;
export type EnrollMfaStartedResponse = Extract<EnrollMfaResponse, { status: "enrollment_started" }>;
export type EnrollMfaAuthenticatedResponse = Extract<
  EnrollMfaResponse,
  { status: "authenticated" }
>;

export type ChangeOwnPasswordRequest = JsonRequestBody<operations["ChangeOwnPassword"]>;
export type ChangeOwnPasswordResponse = JsonResponse<operations["ChangeOwnPassword"], 200>;

export type AcceptInviteRequest = JsonRequestBody<operations["AcceptInvite"]>;
export type AcceptInviteResponse = JsonResponse<operations["AcceptInvite"], 200>;
export type CompletePasswordResetRequest = JsonRequestBody<operations["CompletePasswordReset"]>;
export type CompletePasswordResetResponse = JsonResponse<operations["CompletePasswordReset"], 200>;

export type ErrorEnvelope = JsonResponse<operations["Login"], 401>;

export interface AuthApiTransport {
  readonly mode: "live" | "mock";
  getOwnProfile(): Promise<OwnProfileResponse | null>;
  refreshCsrfToken(): Promise<RefreshCsrfTokenResponse>;
  login(input: LoginRequest): Promise<LoginResponse>;
  verifyMfa(input: VerifyMfaRequest): Promise<VerifyMfaResponse>;
  enrollMfa(input: EnrollMfaRequest): Promise<EnrollMfaResponse>;
  logout(): Promise<void>;
  instantSignIn?(): Promise<AuthenticatedResponse>;
}
