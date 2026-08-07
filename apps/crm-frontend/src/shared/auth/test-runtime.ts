import { ApiError } from "@/shared/api/errors";

export interface TestAuthRuntimeEnvironment {
  VITE_CRM_TEST_AUTH_BYPASS?: string;
}

/**
 * This controls only the visible test-environment marker. The backend is
 * solely responsible for accepting or rejecting the matching MFA bypass.
 */
export function isTestMfaBypassEnabled(
  environment: TestAuthRuntimeEnvironment = import.meta.env as TestAuthRuntimeEnvironment,
): boolean {
  const value = environment.VITE_CRM_TEST_AUTH_BYPASS?.trim().toLowerCase();
  if (!value || value === "false") return false;
  if (value === "true") return true;

  throw new ApiError(
    "TEST_AUTH_BYPASS_INVALID",
    "VITE_CRM_TEST_AUTH_BYPASS должен быть true или false.",
  );
}
