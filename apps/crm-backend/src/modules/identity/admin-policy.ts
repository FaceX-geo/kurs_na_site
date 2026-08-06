import { createHash } from "node:crypto";
import { AppError } from "../../common/errors.js";
import type { AuthContext } from "./service.js";

export const IDENTITY_POLICY_VERSION = "1.2.0";
export const PRIVILEGED_ROLES = new Set([
  "platform_superadmin",
  "crm_admin",
  "project_admin",
  "migration_operator",
  "audit_reader",
]);

export function assertNoSelf(actorId: string, subjectId: string): void {
  if (actorId === subjectId) {
    throw new AppError(
      403,
      "self_operation_denied",
      "Нельзя выполнить эту операцию над своей учётной записью",
    );
  }
}

export function assertFreshMfa(context: AuthContext): void {
  if (context.authenticationLevel !== "fresh_mfa") {
    throw new AppError(403, "fresh_mfa_required", "Повторно подтвердите пароль и второй фактор");
  }
}

export function assertPasswordPolicy(password: string, email?: string): void {
  if (password.length < 12 || Buffer.byteLength(password, "utf8") > 256) {
    throw new AppError(422, "password_policy_failed", "Пароль должен содержать от 12 до 256 байт");
  }
  const folded = password.toLocaleLowerCase("ru-RU");
  const localPart = email?.split("@")[0]?.toLocaleLowerCase("ru-RU");
  if (localPart && localPart.length >= 4 && folded.includes(localPart)) {
    throw new AppError(422, "password_policy_failed", "Пароль не должен содержать адрес входа");
  }
  if (["password", "qwerty", "пароль", "123456789", "kursnasever"].some((part) => folded.includes(part))) {
    throw new AppError(422, "password_policy_failed", "Выберите менее предсказуемый пароль");
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const entries = Object.entries(value as Readonly<Record<string, unknown>>).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

export function approvalPayloadHash(input: Readonly<Record<string, unknown>>): string {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}

export function effectiveAccessFingerprint(input: Readonly<Record<string, unknown>>): string {
  return createHash("sha256")
    .update(`identity-effective-access:${IDENTITY_POLICY_VERSION}:`)
    .update(canonicalJson(input))
    .digest("hex");
}

export function hasPrivilegedRole(roles: readonly string[]): boolean {
  return roles.some((role) => PRIVILEGED_ROLES.has(role));
}
