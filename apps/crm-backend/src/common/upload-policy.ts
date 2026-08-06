/**
 * Durable ceiling shared by the API, object-storage readers and database constraints.
 * Lower runtime limits are allowed, but raising this value requires a forward database migration first.
 */
export const UPLOAD_STORAGE_CEILING_BYTES = 10 * 1024 * 1024;

export function assertUploadLimitWithinStorageCeiling(value: number, label = "Upload byte limit"): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > UPLOAD_STORAGE_CEILING_BYTES) {
    throw new Error(
      `${label} must be a positive safe integer no greater than ${UPLOAD_STORAGE_CEILING_BYTES}`,
    );
  }
  return value;
}
