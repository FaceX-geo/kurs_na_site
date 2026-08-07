import createClient from "openapi-fetch";
import { normalizeApiError } from "@/shared/api/errors";
import type { paths } from "@/shared/api/generated/openapi";

export interface CrmApiClientOptions {
  baseUrl?: string;
  fetch?: (request: Request) => Promise<Response>;
}

interface OpenApiResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

function resolveBaseUrl(explicitBaseUrl?: string): string {
  return explicitBaseUrl ?? import.meta.env.VITE_CRM_API_BASE_URL ?? "";
}

export function createCrmApiClient(options: CrmApiClientOptions = {}) {
  return createClient<paths>({
    baseUrl: resolveBaseUrl(options.baseUrl),
    credentials: "include",
    headers: { accept: "application/json" },
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
}

export function requireApiData<T>(result: OpenApiResult<T>): T {
  if (result.error !== undefined) {
    throw normalizeApiError(result.error, result.response);
  }
  if (result.data === undefined) {
    throw normalizeApiError(
      new Error(`CRM API returned ${result.response.status} without a response body.`),
      result.response,
    );
  }
  return result.data;
}

export function requireApiSuccess(result: OpenApiResult<unknown>): void {
  if (result.error !== undefined) {
    throw normalizeApiError(result.error, result.response);
  }
  if (!result.response.ok) {
    throw normalizeApiError(
      new Error(`CRM API returned ${result.response.status}.`),
      result.response,
    );
  }
}

export const crmApiClient = createCrmApiClient();
