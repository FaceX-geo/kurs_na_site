import type { ErrorEnvelope } from "@/shared/api/contracts";

interface ApiErrorOptions {
  cause?: unknown;
  details?: Record<string, unknown>;
  fieldErrors?: ErrorEnvelope["errors"];
  requestId?: string;
  status?: number;
}

export class ApiError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;
  readonly fieldErrors?: ErrorEnvelope["errors"];
  readonly requestId?: string;
  readonly status?: number;

  constructor(code: string, message: string, options: ApiErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ApiError";
    this.code = code;
    if (options.details !== undefined) this.details = options.details;
    if (options.fieldErrors !== undefined) this.fieldErrors = options.fieldErrors;
    if (options.requestId !== undefined) this.requestId = options.requestId;
    if (options.status !== undefined) this.status = options.status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function normalizeApiError(error: unknown, response?: Response): ApiError {
  if (error instanceof ApiError) return error;

  const body = isRecord(error) ? error : undefined;
  const status = response?.status;
  const requestId =
    readString(body?.requestId) ?? response?.headers.get("x-request-id") ?? undefined;
  const code = readString(body?.code) ?? (status ? `HTTP_${status}` : "NETWORK_ERROR");
  const fallbackMessage = status
    ? `CRM API вернул ошибку ${status}.`
    : "Не удалось связаться с CRM API.";
  const message =
    readString(body?.message) ?? (error instanceof Error ? error.message : fallbackMessage);
  const details = isRecord(body?.details) ? body.details : undefined;
  const fieldErrors = Array.isArray(body?.errors)
    ? (body.errors as ErrorEnvelope["errors"])
    : undefined;

  return new ApiError(code, message, {
    ...(details === undefined ? {} : { details }),
    ...(fieldErrors === undefined ? {} : { fieldErrors }),
    ...(requestId === undefined ? {} : { requestId }),
    ...(status === undefined ? {} : { status }),
    cause: error,
  });
}
