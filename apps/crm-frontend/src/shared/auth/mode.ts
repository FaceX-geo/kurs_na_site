import { ApiError } from "@/shared/api/errors";
import type { AuthMode } from "@/shared/auth/types";

export interface AuthRuntimeEnvironment {
  PROD: boolean;
  VITE_CRM_AUTH_MODE?: string;
}

export function resolveAuthMode(environment: AuthRuntimeEnvironment = import.meta.env): AuthMode {
  const configuredMode = environment.VITE_CRM_AUTH_MODE?.trim().toLowerCase();

  if (configuredMode && configuredMode !== "live" && configuredMode !== "mock") {
    throw new ApiError(
      "AUTH_MODE_INVALID",
      `Неизвестный VITE_CRM_AUTH_MODE: ${configuredMode}. Допустимы live или mock.`,
    );
  }

  if (environment.PROD && configuredMode === "mock") {
    throw new ApiError(
      "MOCK_AUTH_FORBIDDEN",
      "Тестовая авторизация запрещена в production-сборке.",
    );
  }

  if (configuredMode === "live" || configuredMode === "mock") return configuredMode;
  return environment.PROD ? "live" : "mock";
}
