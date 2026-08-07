import { createHmac } from "node:crypto";
import { AppError } from "../../common/errors.js";
import type { ProvisionedSpecialistReceipt, ProvisionSpecialistInput } from "./admin-contracts.js";
import type { AuthContext } from "./service.js";

export const SPECIALIST_PROVISIONING_OPERATION_ID = "ProvisionSpecialist";

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;

function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) {
      throw new Error("Specialist provisioning idempotency payload is not JSON serializable");
    }
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;

  const entries = Object.entries(value as Readonly<Record<string, unknown>>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

function normalizedSet(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export interface SpecialistProvisioningIdempotency {
  readonly key: string;
  readonly scope: string;
  readonly requestHash: string;
  readonly employeeProfileId: string;
}

export function specialistProvisioningIdempotencyScope(actorUserAccountId: string): string {
  return `identity.specialist.provision:${actorUserAccountId.toLocaleLowerCase("en-US")}`;
}

export function createSpecialistProvisioningIdempotency(input: {
  readonly hashingKey: string;
  readonly idempotencyKey: string;
  readonly actor: AuthContext;
  readonly payload: ProvisionSpecialistInput;
}): SpecialistProvisioningIdempotency {
  if (!IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey)) {
    throw new AppError(422, "invalid_idempotency_key", "Передайте корректный Idempotency-Key");
  }
  if (input.hashingKey.length < 32) {
    throw new Error("Specialist provisioning request hashing key must contain at least 32 characters");
  }

  const employeeProfileId = input.payload.employeeProfileId.toLocaleLowerCase("en-US");
  const requestHash = createHmac("sha256", input.hashingKey)
    .update("kurs-na-sever/identity-specialist-provisioning/v1\0")
    .update(
      canonicalJson({
        operationId: SPECIALIST_PROVISIONING_OPERATION_ID,
        actorUserAccountId: input.actor.userAccountId.toLocaleLowerCase("en-US"),
        employeeProfileId,
        payload: {
          email: input.payload.email.trim().toLocaleLowerCase("en-US"),
          reason: input.payload.reason.trim(),
        },
        access: {
          authenticationLevel: input.actor.authenticationLevel,
          businessRole: input.actor.businessRole,
          employeeProfileId: input.actor.employeeProfileId,
          roles: normalizedSet(input.actor.roles),
          permissions: normalizedSet(input.actor.permissions),
        },
      }),
    )
    .digest("hex");

  return {
    key: input.idempotencyKey,
    scope: specialistProvisioningIdempotencyScope(input.actor.userAccountId),
    requestHash,
    employeeProfileId,
  };
}

export interface StoredSpecialistProvisioningIdempotencyRecord {
  readonly request_hash: string;
  readonly response_status: number | null;
  readonly response_body: unknown;
  readonly resource_id: string | null;
  readonly state: string;
  readonly expires_at: Date | string;
}

function isProvisionedSpecialistReceipt(value: unknown): value is ProvisionedSpecialistReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const receipt = value as Readonly<Record<string, unknown>>;
  return (
    typeof receipt.id === "string" &&
    UUID_PATTERN.test(receipt.id) &&
    typeof receipt.auditEventId === "string" &&
    UUID_PATTERN.test(receipt.auditEventId) &&
    receipt.operationId === SPECIALIST_PROVISIONING_OPERATION_ID &&
    typeof receipt.requestId === "string" &&
    receipt.requestId.length > 0 &&
    typeof receipt.userId === "string" &&
    UUID_PATTERN.test(receipt.userId) &&
    typeof receipt.employeeProfileId === "string" &&
    UUID_PATTERN.test(receipt.employeeProfileId) &&
    receipt.businessRole === "SPECIALIST" &&
    typeof receipt.expiresAt === "string" &&
    !Number.isNaN(Date.parse(receipt.expiresAt)) &&
    typeof receipt.occurredAt === "string" &&
    !Number.isNaN(Date.parse(receipt.occurredAt)) &&
    receipt.credentialDelivery === "queued_internal"
  );
}

export function readSpecialistProvisioningReplay(
  record: StoredSpecialistProvisioningIdempotencyRecord,
  query: {
    readonly employeeProfileId: string;
    readonly requestHash: string;
  },
  now = new Date(),
): ProvisionedSpecialistReceipt {
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
    record.response_status !== 202 ||
    !isProvisionedSpecialistReceipt(record.response_body) ||
    record.resource_id !== record.response_body.userId
  ) {
    throw new Error("Stored specialist provisioning receipt is invalid");
  }
  if (
    record.response_body.id !== record.response_body.auditEventId ||
    record.response_body.employeeProfileId.toLocaleLowerCase("en-US") !==
      query.employeeProfileId.toLocaleLowerCase("en-US")
  ) {
    throw new Error("Stored specialist provisioning receipt binding is invalid");
  }
  return record.response_body;
}
