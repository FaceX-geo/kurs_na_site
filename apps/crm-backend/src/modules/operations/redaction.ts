const STABLE_CODE = /^[A-Z0-9_]{1,128}$/;
const POLICY_VERSION = /^[A-Za-z0-9_.:-]{1,128}$/;

/**
 * Audit reasons may be human-entered and can contain PII. Only explicit,
 * machine-stable codes are allowed to cross the read-model boundary.
 */
export function redactAuditReason(value: string | null): string | null {
  return value && STABLE_CODE.test(value) ? value : null;
}

export function redactPolicyVersion(value: string | null): string | null {
  return value && POLICY_VERSION.test(value) ? value : null;
}

export function redactBlockerCodes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const codeFrom = (item: unknown): string | null => {
    if (typeof item === "string") {
      return STABLE_CODE.test(item) ? item : null;
    }
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      const code = (item as Readonly<Record<string, unknown>>).code;
      return typeof code === "string" && STABLE_CODE.test(code) ? code : null;
    }
    return null;
  };
  return [...new Set(value.map(codeFrom).filter((item): item is string => item !== null))].slice(0, 256);
}

export function nonNegativeInteger(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.trunc(parsed);
}
