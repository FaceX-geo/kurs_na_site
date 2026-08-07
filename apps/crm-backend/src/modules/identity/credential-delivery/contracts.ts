import { createHmac } from "node:crypto";
import { z } from "zod";

export const CREDENTIAL_DELIVERY_TOPIC = "identity.credential.delivery_requested";
export const CREDENTIAL_DELIVERY_CONSUMER = "identity-credential-delivery-v1";
export const CREDENTIAL_DELIVERY_WEBHOOK_SCHEMA = "credential-delivery.webhook.v1";

export type CredentialPurpose = "invite" | "reset";

const credentialDeliveryPayloadSchema = z
  .object({
    userAccountId: z.string().uuid(),
    credentialTokenId: z.string().uuid(),
    purpose: z.enum(["invite", "reset"]),
  })
  .strict();

const credentialDeliveryDestinationSchema = z.string().trim().toLowerCase().email().max(320);

export interface CredentialDeliveryPayload extends Readonly<Record<string, unknown>> {
  readonly userAccountId: string;
  readonly credentialTokenId: string;
  readonly purpose: CredentialPurpose;
}

export function parseCredentialDeliveryPayload(value: unknown): CredentialDeliveryPayload | null {
  const result = credentialDeliveryPayloadSchema.safeParse(value);
  return result.success ? result.data : null;
}

/** Resolves and normalizes PII only after the worker loads the authoritative account row. */
export function parseCredentialDeliveryDestination(value: unknown): string | null {
  const result = credentialDeliveryDestinationSchema.safeParse(value);
  return result.success ? result.data : null;
}

/**
 * The raw credential is deterministic so the API can persist only its keyed
 * hash while a separate worker reconstructs the value immediately before I/O.
 */
export function deriveCredentialToken(tokenId: string, purpose: CredentialPurpose, secret: string): string {
  if (secret.length < 32) {
    throw new Error("Credential token derivation secret is too short");
  }
  const proof = createHmac("sha256", secret)
    .update(`identity-credential:${purpose}:${tokenId}`)
    .digest("base64url");
  return `${tokenId}.${proof}`;
}

export function credentialRetryDelayMs(
  attemptCount: number,
  baseBackoffMs: number,
  maxBackoffMs: number,
): number {
  const exponent = Math.max(0, Math.min(30, attemptCount - 1));
  return Math.min(maxBackoffMs, baseBackoffMs * 2 ** exponent);
}
