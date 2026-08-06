import { createHmac, timingSafeEqual } from "node:crypto";

export const UPLOAD_BINDING_KEY_VERSION = 1;

const DERIVATION_CONTEXT = "kurs-na-sever/intake-upload-binding/derive/v1";
const TOKEN_CONTEXT = "kurs-na-sever/intake-upload-binding/token/v1";
const STORAGE_CONTEXT = "kurs-na-sever/intake-upload-binding/storage/v1";

function bindingKey(rootSecret: string): Buffer {
  return createHmac("sha256", rootSecret).update(DERIVATION_CONTEXT).digest();
}

function keyedTokenHash(token: string, rootSecret: string): string {
  return createHmac("sha256", bindingKey(rootSecret))
    .update(STORAGE_CONTEXT)
    .update("\0")
    .update(token)
    .digest("hex");
}

export interface IssuedUploadBinding {
  readonly token: string;
  readonly tokenHash: string;
  readonly keyVersion: number;
}

/**
 * Re-derivable for an idempotent upload replay. The token is opaque to the client and only its
 * keyed hash is persisted. Rotation must retain v1 until all unconsumed 24-hour uploads expire,
 * or those uploads must be invalidated and re-uploaded.
 */
export function issueUploadBinding(
  uploadId: string,
  publicId: string,
  rootSecret: string,
): IssuedUploadBinding {
  const tokenMac = createHmac("sha256", bindingKey(rootSecret))
    .update(TOKEN_CONTEXT)
    .update("\0")
    .update(uploadId)
    .update("\0")
    .update(publicId)
    .digest("base64url");
  const token = `ub1.${tokenMac}`;
  return {
    token,
    tokenHash: keyedTokenHash(token, rootSecret),
    keyVersion: UPLOAD_BINDING_KEY_VERSION,
  };
}

export function verifyUploadBinding(
  token: string,
  storedHash: string,
  keyVersion: number,
  rootSecret: string,
): boolean {
  if (keyVersion !== UPLOAD_BINDING_KEY_VERSION || !/^[a-f0-9]{64}$/u.test(storedHash)) {
    return false;
  }
  const expected = Buffer.from(storedHash, "hex");
  const actual = Buffer.from(keyedTokenHash(token, rootSecret), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Produces a stored idempotency digest influenced by the credential without storing a raw/plain hash. */
export function keyApplicationRequestHash(
  safeRequestHash: string,
  bindingToken: string | null,
  rootSecret: string,
): string {
  return createHmac("sha256", bindingKey(rootSecret))
    .update("kurs-na-sever/intake-application-idempotency/v1")
    .update("\0")
    .update(safeRequestHash)
    .update("\0")
    .update(bindingToken ?? "legacy-without-binding")
    .digest("hex");
}
