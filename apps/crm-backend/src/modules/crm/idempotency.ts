import { createHmac } from "node:crypto";
import { Value } from "@sinclair/typebox/value";
import { AppError } from "../../common/errors.js";
import {
  type CrmCaseTransitionBody,
  type CrmCaseTransitionResult,
  CrmCaseTransitionResultSchema,
} from "./contracts.js";
import type { CrmAccessScope, CrmActorContext, CrmIdempotencyContext } from "./ports.js";

const CASE_TRANSITION_OPERATION_ID = "TransitionCase";

function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("CRM idempotency payload is not JSON serializable");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;

  const entries = Object.entries(value as Readonly<Record<string, unknown>>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

export function crmCaseTransitionIdempotencyScope(actorUserAccountId: string, caseId: string): string {
  return `crm.case.transition:${actorUserAccountId}:${caseId}`;
}

export function createCrmCaseTransitionIdempotency(input: {
  readonly hashingKey: string;
  readonly idempotencyKey: string;
  readonly actor: CrmActorContext;
  readonly access: CrmAccessScope;
  readonly caseId: string;
  readonly expectedVersion: number;
  readonly body: CrmCaseTransitionBody;
}): CrmIdempotencyContext {
  const requestHash = createHmac("sha256", input.hashingKey)
    .update(
      canonicalJson({
        operationId: CASE_TRANSITION_OPERATION_ID,
        actorUserAccountId: input.actor.userAccountId,
        access: {
          visibility: input.access.visibility,
          actorUserAccountId: input.access.actorUserAccountId,
          actorEmployeeProfileId: input.access.actorEmployeeProfileId,
          employeeProfileIds: [...input.access.employeeProfileIds].sort(),
          teamIds: [...input.access.teamIds].sort(),
          organizationUnitIds: [...input.access.organizationUnitIds].sort(),
          fieldMask: [...input.access.fieldMask].sort(),
        },
        caseId: input.caseId,
        expectedVersion: input.expectedVersion,
        body: input.body,
      }),
    )
    .digest("hex");

  return {
    key: input.idempotencyKey,
    scope: crmCaseTransitionIdempotencyScope(input.actor.userAccountId, input.caseId),
    requestHash,
  };
}

export interface StoredCrmCaseTransitionIdempotencyRecord {
  readonly request_hash: string;
  readonly response_status: number | null;
  readonly response_body: unknown;
  readonly resource_id: string | null;
  readonly state: string;
  readonly expires_at: Date | string;
}

export function readCrmCaseTransitionReplay(
  record: StoredCrmCaseTransitionIdempotencyRecord,
  query: { readonly aggregateId: string; readonly requestHash: string },
  now = new Date(),
): CrmCaseTransitionResult {
  if (record.request_hash !== query.requestHash) {
    throw new AppError(409, "idempotency_conflict", "Idempotency-Key уже использован с другим запросом");
  }
  if (new Date(record.expires_at) <= now) {
    throw new AppError(409, "idempotency_expired", "Idempotency-Key истёк; используйте новый ключ");
  }
  if (record.state !== "completed") {
    throw new AppError(409, "idempotency_in_progress", "Операция с этим ключом ещё выполняется");
  }
  if (
    record.response_status !== 200 ||
    record.resource_id !== query.aggregateId ||
    !Value.Check(CrmCaseTransitionResultSchema, record.response_body)
  ) {
    throw new Error("Stored CRM case transition receipt is invalid");
  }

  const value = record.response_body as CrmCaseTransitionResult;
  if (
    value.case.id !== query.aggregateId ||
    value.receipt.caseId !== query.aggregateId ||
    value.receipt.id !== value.receipt.auditEventId ||
    value.receipt.version !== value.case.version
  ) {
    throw new Error("Stored CRM case transition receipt binding is invalid");
  }
  return value;
}
