import {
  ApiError,
  buildMutationHeaders,
  createIdempotencyKey,
  crmApiClient,
  type operations,
  requireApiData,
} from "@/shared/api";

type TransitionCaseBody =
  operations["TransitionCase"]["requestBody"]["content"]["application/json"];
type TransitionCaseHeaders = operations["TransitionCase"]["parameters"]["header"];
type TransitionCaseResponse =
  operations["TransitionCase"]["responses"][200]["content"]["application/json"];

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export interface CaseTransitionDraft {
  caseId: string;
  expectedVersion: number;
  idempotencyKey: string;
  body: TransitionCaseBody;
}

export type CaseTransitionEvidence = TransitionCaseResponse & {
  etag: string;
  idempotencyReplayed?: boolean;
};

export function createCaseTransitionDraft(
  input: Omit<CaseTransitionDraft, "idempotencyKey">,
): CaseTransitionDraft {
  return { ...input, idempotencyKey: createIdempotencyKey() };
}

export async function transitionCase(draft: CaseTransitionDraft): Promise<CaseTransitionEvidence> {
  if (!IDEMPOTENCY_KEY_PATTERN.test(draft.idempotencyKey)) {
    throw new ApiError(
      "INVALID_IDEMPOTENCY_KEY",
      "Черновик изменения этапа имеет некорректный ключ запроса. Создайте его заново.",
    );
  }
  const headers = buildMutationHeaders({
    csrf: "required",
    idempotencyKey: draft.idempotencyKey,
    ifMatch: String(draft.expectedVersion),
  });
  const csrfToken = headers["x-csrf-token"];
  const ifMatch = headers["if-match"];
  const idempotencyKey = headers["idempotency-key"];
  if (!csrfToken || !ifMatch || !idempotencyKey) {
    throw new Error("Case transition mutation header invariant failed");
  }

  // Keep the operation headers in one object so the current contract and the
  // forthcoming required Idempotency-Key contract both receive the same key.
  const operationHeaders: TransitionCaseHeaders = {
    "x-csrf-token": csrfToken,
    "if-match": ifMatch,
    "idempotency-key": idempotencyKey,
  };
  const result = await crmApiClient.POST("/internal/v1/crm/cases/{caseId}/transitions", {
    params: {
      path: { caseId: draft.caseId },
      header: operationHeaders,
    },
    body: draft.body,
  });
  const value = requireApiData(result);
  const evidence = parseTransitionEvidence(value);
  const etag = result.response.headers.get("etag") ?? undefined;
  const replayHeader = result.response.headers.get("idempotency-replayed");
  if (etag !== `"v${evidence.case.version}"`) throw contractMismatch();
  if (replayHeader && replayHeader.toLowerCase() !== "true") throw contractMismatch();

  return {
    ...evidence,
    etag,
    ...(replayHeader ? { idempotencyReplayed: replayHeader.toLowerCase() === "true" } : {}),
  };
}

function parseTransitionEvidence(value: unknown): TransitionCaseResponse {
  if (!isRecord(value) || !isRecord(value.case) || !isRecord(value.receipt)) {
    throw contractMismatch();
  }
  const caseValue = value.case;
  const receipt = value.receipt;
  if (
    !isString(caseValue.id) ||
    !isString(caseValue.publicId) ||
    !isString(caseValue.stageCode) ||
    !isVersion(caseValue.version) ||
    !isString(caseValue.updatedAt) ||
    !isString(receipt.id) ||
    !isString(receipt.auditEventId) ||
    receipt.operationId !== "TransitionCase" ||
    !isString(receipt.requestId) ||
    !isString(receipt.caseId) ||
    !isVersion(receipt.version) ||
    !isString(receipt.occurredAt) ||
    receipt.id !== receipt.auditEventId ||
    receipt.caseId !== caseValue.id ||
    receipt.version !== caseValue.version
  ) {
    throw contractMismatch();
  }

  return value as TransitionCaseResponse;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function contractMismatch(): ApiError {
  return new ApiError(
    "TRANSITION_RECEIPT_CONTRACT_MISMATCH",
    "Backend не вернул проверяемую квитанцию изменения этапа. Состояние заявки нужно обновить.",
  );
}
