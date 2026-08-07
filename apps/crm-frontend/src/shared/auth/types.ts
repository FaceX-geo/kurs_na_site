import type {
  AuthApiTransport,
  EnrollMfaStartedResponse,
  LoginPendingResponse,
  LoginRequest,
} from "@/shared/api/contracts";
import type { ApiError } from "@/shared/api/errors";

export type AuthMode = "live" | "mock";
export type AuthStatus = "loading" | "authenticated" | "anonymous";
export type BusinessRole = "SUPER_ADMIN" | "SPECIALIST";
export type DataScope = "assigned" | "team" | "department" | "all";

export interface AuthSessionUser {
  businessRole: BusinessRole | null;
  id: string;
  email: string;
  displayName: string;
  employeeProfileId: string | null;
  roles: string[];
  permissions: string[];
}

export interface AuthSession {
  authenticationLevel: string;
  businessRole: BusinessRole | null;
  displayName: string;
  expiresAt?: string;
  roleLabel: string;
  mutationAccess: "ready" | "reauth_required";
  scopeVisibility: DataScope | null;
  user: AuthSessionUser;
}

export interface AuthContextValue {
  authMode: AuthMode;
  status: AuthStatus;
  session: AuthSession | null;
  pendingAuth: LoginPendingResponse | null;
  error: ApiError | null;
  clearError(): void;
  enterManualAuth(): void;
  instantSignIn(): Promise<void>;
  signInWithPassword(input: LoginRequest): Promise<LoginPendingResponse | null>;
  verifyMax(code: string): Promise<void>;
  recoverMax(recoveryCode: string): Promise<void>;
  reauthenticate(password: string, mfaCode: string): Promise<void>;
  startMfaEnrollment(): Promise<EnrollMfaStartedResponse>;
  confirmMfaEnrollment(code: string): Promise<readonly string[]>;
  signOut(): Promise<void>;
}

export interface AuthProviderProps {
  autoAuthenticate?: boolean;
  children: React.ReactNode;
  mode?: AuthMode;
  transport?: AuthApiTransport;
}
