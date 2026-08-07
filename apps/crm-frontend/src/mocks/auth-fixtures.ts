import type { AuthenticatedResponse, OwnProfileResponse } from "@/shared/api/contracts";

const MOCK_USER_ID = "00000000-0000-4000-8000-000000000101";

export function createMockAuthenticatedResponse(): AuthenticatedResponse {
  return {
    status: "authenticated",
    csrfToken: "mock-csrf-token-not-for-production",
    expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    user: {
      id: MOCK_USER_ID,
      email: "olga.lebedeva@example.test",
      displayName: "Ольга Лебедева",
      roles: ["crm_project_manager"],
      permissions: [
        "crm.dashboard.read",
        "crm.case.list",
        "crm.case.read",
        "crm.task.read",
        "crm.employer.read",
        "crm.report.build",
        "crm.notification.read",
      ],
      businessRole: "SPECIALIST",
      employeeProfileId: "00000000-0000-4000-8000-000000000201",
    },
  } as AuthenticatedResponse;
}

export function createMockOwnProfile(
  authenticationLevel: "mfa" | "fresh_mfa" = "mfa",
): OwnProfileResponse {
  return {
    userAccountId: MOCK_USER_ID,
    email: "olga.lebedeva@example.test",
    authenticationLevel,
    roles: ["crm_project_manager"],
    permissions: [
      "crm.dashboard.read",
      "crm.case.list",
      "crm.case.read",
      "crm.case.transition",
      "crm.case.update",
      "crm.task.read",
      "crm.task.manage",
      "crm.employer.read",
      "crm.report.build",
      "crm.notification.read",
    ],
    businessRole: "SPECIALIST",
    employeeProfileId: "00000000-0000-4000-8000-000000000201",
  } as OwnProfileResponse;
}

export const MOCK_AUTH_COPY = {
  badge: "ТЕСТОВЫЙ КОНТУР · MAX НЕ ВЫЗЫВАЕТСЯ",
  challengeHint: "Введите любые 6 цифр — это локальная проверка интерфейса.",
  disclaimer: "Заглушка не отправляет сообщения, не открывает MAX и не содержит рабочих ключей.",
} as const;
