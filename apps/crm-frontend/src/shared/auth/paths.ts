export const AUTH_PATHS = {
  login: "/cabinet/login",
  acceptInvite: "/cabinet/invite/accept",
  completePasswordReset: "/cabinet/password/reset",
  mfa: "/cabinet/mfa",
  recovery: "/cabinet/recovery",
  enroll: "/cabinet/mfa/enroll",
  home: "/cabinet/crm",
  dashboard: "/cabinet/crm/dashboard",
} as const;

export type AuthPath = (typeof AUTH_PATHS)[keyof typeof AUTH_PATHS];
