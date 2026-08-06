import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "./errors.js";

export interface CursorValue {
  createdAt: string;
  id: string;
}

export interface Page<T> {
  items: T[];
  page: {
    limit: number;
    nextCursor: string | null;
    hasMore: boolean;
  };
}

interface CursorPayload extends CursorValue {
  version: 1;
}

function signature(payload: string, signingKey: string): Buffer {
  return createHmac("sha256", signingKey).update(payload).digest();
}

export function encodeCursor(value: CursorValue, signingKey: string): string {
  const payload = Buffer.from(JSON.stringify({ version: 1, ...value } satisfies CursorPayload)).toString(
    "base64url",
  );
  return `${payload}.${signature(payload, signingKey).toString("base64url")}`;
}

export function decodeCursor(cursor: string | undefined, signingKey: string): CursorValue | undefined {
  if (!cursor) {
    return undefined;
  }

  const [payload, providedSignature] = cursor.split(".");
  if (!payload || !providedSignature) {
    throw new AppError(422, "invalid_cursor", "Курсор пагинации некорректен");
  }

  const expected = signature(payload, signingKey);
  const provided = Buffer.from(providedSignature, "base64url");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new AppError(422, "invalid_cursor", "Курсор пагинации некорректен");
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<CursorPayload>;
    if (parsed.version !== 1 || typeof parsed.createdAt !== "string" || typeof parsed.id !== "string") {
      throw new Error("invalid cursor payload");
    }
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    throw new AppError(422, "invalid_cursor", "Курсор пагинации некорректен");
  }
}

export function boundedLimit(value: number | undefined, defaultValue = 50, maximum = 200): number {
  if (value === undefined) {
    return defaultValue;
  }
  return Math.max(1, Math.min(maximum, Math.trunc(value)));
}
