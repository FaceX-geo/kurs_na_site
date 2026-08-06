import { v7 as uuidv7 } from "uuid";

const PREFIXES = {
  request: "req",
  application: "app",
  upload: "file",
  person: "person",
  case: "case",
  employer: "employer",
  referral: "referral",
  task: "task",
  activity: "activity",
  user: "user",
  session: "session",
  event: "event",
  migration: "migration",
  conflict: "conflict",
} as const;

export type IdKind = keyof typeof PREFIXES;

export function newUuid(): string {
  return uuidv7();
}

export function newPublicId(kind: IdKind): string {
  return `${PREFIXES[kind]}_${uuidv7().replaceAll("-", "")}`;
}
