import { type CsrfTokenStore, csrfTokenStore } from "@/shared/api/csrf";
import { ApiError } from "@/shared/api/errors";

export interface MutationRequestDescriptor {
  csrf: "none" | "optional" | "required";
  idempotencyKey?: string;
  ifMatch?: string;
}

export function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `crm-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function buildMutationHeaders(
  descriptor: MutationRequestDescriptor,
  csrfStore: CsrfTokenStore = csrfTokenStore,
): Record<string, string> {
  const headers: Record<string, string> = {};
  const csrfToken = csrfStore.read();

  if (descriptor.csrf === "required" && !csrfToken) {
    throw new ApiError(
      "CSRF_TOKEN_MISSING",
      "Сеанс нельзя безопасно изменить: CSRF-токен отсутствует. Войдите заново.",
    );
  }

  if (descriptor.csrf !== "none" && csrfToken) headers["x-csrf-token"] = csrfToken;
  if (descriptor.idempotencyKey) headers["idempotency-key"] = descriptor.idempotencyKey;
  if (descriptor.ifMatch) headers["if-match"] = descriptor.ifMatch;

  return headers;
}
