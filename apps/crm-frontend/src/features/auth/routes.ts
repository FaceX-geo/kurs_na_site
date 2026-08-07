import { InviteAcceptPage, PasswordResetPage } from "@/features/auth/CredentialSetupPage";
import { LoginPage } from "@/features/auth/LoginPage";
import { MaxChallengePage } from "@/features/auth/MaxChallengePage";
import { MaxEnrollPage } from "@/features/auth/MaxEnrollPage";
import { MaxRecoveryPage } from "@/features/auth/MaxRecoveryPage";
import { AUTH_PATHS } from "@/shared/auth";

export const AUTH_ROUTES = [
  { path: AUTH_PATHS.login, Component: LoginPage },
  { path: AUTH_PATHS.acceptInvite, Component: InviteAcceptPage },
  { path: AUTH_PATHS.completePasswordReset, Component: PasswordResetPage },
  { path: AUTH_PATHS.mfa, Component: MaxChallengePage },
  { path: AUTH_PATHS.recovery, Component: MaxRecoveryPage },
  { path: AUTH_PATHS.enroll, Component: MaxEnrollPage },
] as const;
