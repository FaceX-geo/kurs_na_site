import { createHash } from "node:crypto";
import { Value } from "@sinclair/typebox/value";
import { type IntakeValidationIssue, validationError } from "./errors.js";
import type {
  NormalizedApplicationInput,
  NormalizedAttributionTouch,
  NormalizedEntryPoint,
  NormalizedMeta,
} from "./ports.js";
import { type ApplicationPayload, ApplicationPayloadSchema } from "./schemas.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const MONTH_PATTERN = /^[0-9]{4}-(0[1-9]|1[0-2])$/u;
const RELOCATION_ONLY_FIELDS = ["sphere", "wishPost", "wishSalary"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function nullableText(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = collapseWhitespace(value);
  return normalized || null;
}

function fieldFromPath(path: string): string {
  if (!path) {
    return "body";
  }
  return path
    .replace(/^\//u, "")
    .split("/")
    .map((part) => part.replace(/~1/gu, "/").replace(/~0/gu, "~"))
    .join(".");
}

function schemaIssues(value: unknown): IntakeValidationIssue[] {
  const seen = new Set<string>();
  const issues: IntakeValidationIssue[] = [];
  for (const error of Value.Errors(ApplicationPayloadSchema, value)) {
    const field = fieldFromPath(error.path);
    const key = `${field}:${error.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    issues.push({ field, code: "invalid", message: error.message });
  }
  return issues;
}

function mixedPayloadIssues(value: unknown): IntakeValidationIssue[] {
  if (!isRecord(value) || !isRecord(value.application)) {
    return [];
  }
  const application = value.application;
  if (application.applicantType === "relocation" && Object.hasOwn(application, "studentProfile")) {
    return [
      {
        field: "application.studentProfile",
        code: "forbidden_for_applicant_type",
        message: "studentProfile недопустим для маршрута relocation.",
      },
    ];
  }
  if (application.applicantType === "student") {
    return RELOCATION_ONLY_FIELDS.filter((field) => Object.hasOwn(application, field)).map((field) => ({
      field: `application.${field}`,
      code: "forbidden_for_applicant_type",
      message: `${field} недопустим для маршрута student.`,
    }));
  }
  return [];
}

function normalizePhone(value: string): string | null {
  let digits = value.replace(/\D/gu, "");
  if (digits.length === 10 && digits.startsWith("9")) {
    digits = `7${digits}`;
  } else if (digits.length === 11 && digits.startsWith("8")) {
    digits = `7${digits.slice(1)}`;
  }
  return digits.length === 11 && digits.startsWith("7") ? `+${digits}` : null;
}

function normalizeDate(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return value;
}

function normalizeInstant(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeSalary(value: string | number | undefined): number | null {
  if (typeof value === "undefined" || value === "") {
    return null;
  }
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000 ? value : null;
  }
  const digits = value.replace(/[\s\u00a0]/gu, "");
  if (!/^\d+$/u.test(digits)) {
    return null;
  }
  const parsed = Number(digits);
  return Number.isSafeInteger(parsed) && parsed <= 1_000_000_000 ? parsed : null;
}

function compactStringRecord(value: Record<string, string | undefined> | undefined): Record<string, string> {
  if (!value) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [key, typeof item === "string" ? item.trim() : ""] as const)
      .filter(([, item]) => item.length > 0),
  );
}

function normalizeTouch(
  value:
    | {
        capturedAt?: string;
        landingUrl?: string;
        referrer?: string;
        utm?: Record<string, string | undefined>;
        clickIds?: Record<string, string | undefined>;
      }
    | undefined,
): NormalizedAttributionTouch | null {
  if (!value) {
    return null;
  }
  return {
    capturedAt: normalizeInstant(value.capturedAt),
    landingUrl: nullableText(value.landingUrl),
    referrer: nullableText(value.referrer),
    utm: compactStringRecord(value.utm),
    clickIds: compactStringRecord(value.clickIds),
  };
}

function normalizeEntryPoint(meta: ApplicationPayload["meta"]): NormalizedEntryPoint {
  const entryPoint = meta?.entryPoint;
  return {
    code: nullableText(entryPoint?.code) ?? nullableText(entryPoint?.source) ?? "direct",
    role: nullableText(entryPoint?.role),
    sphere: nullableText(entryPoint?.sphere),
    city: nullableText(entryPoint?.city),
    applicantType: entryPoint?.applicantType || null,
    vacancyId: nullableText(entryPoint?.vacancyId),
    vacancySector: entryPoint?.vacancySector || null,
  };
}

function normalizeMeta(meta: ApplicationPayload["meta"]): NormalizedMeta {
  const legacyUtm = compactStringRecord(meta?.utm);
  const explicitLastTouch = normalizeTouch(meta?.attribution?.lastTouch);
  const legacyLastTouch: NormalizedAttributionTouch | null = Object.keys(legacyUtm).length
    ? {
        capturedAt: normalizeInstant(meta?.timestamp),
        landingUrl: nullableText(meta?.landing?.url),
        referrer: null,
        utm: legacyUtm,
        clickIds: {},
      }
    : null;

  return {
    source: nullableText(meta?.source) ?? "web",
    entryPoint: normalizeEntryPoint(meta),
    legacyUtm,
    submittedAt: normalizeInstant(meta?.timestamp),
    legacyClientFingerprint: nullableText(meta?.clientFingerprint),
    sessionId: nullableText(meta?.sessionId),
    consentState: meta?.consentState ?? null,
    landing: {
      host: nullableText(meta?.landing?.host)?.toLocaleLowerCase("en-US") ?? null,
      path: nullableText(meta?.landing?.path),
      url: nullableText(meta?.landing?.url),
    },
    firstTouch: normalizeTouch(meta?.attribution?.firstTouch),
    lastTouch: explicitLastTouch ?? legacyLastTouch,
  };
}

function ageOnDate(birthdate: string, now: Date): number {
  const [year = 0, month = 0, day = 0] = birthdate.split("-").map(Number);
  let age = now.getUTCFullYear() - year;
  const beforeBirthday =
    now.getUTCMonth() + 1 < month || (now.getUTCMonth() + 1 === month && now.getUTCDate() < day);
  if (beforeBirthday) {
    age -= 1;
  }
  return age;
}

export function normalizeApplicationPayload(
  value: unknown,
  options: {
    readonly now?: Date;
    readonly requireConsentEvidence?: boolean;
    readonly requireUploadBinding?: boolean;
  } = {},
): NormalizedApplicationInput {
  const mixedIssues = mixedPayloadIssues(value);
  if (mixedIssues.length) {
    throw validationError(mixedIssues);
  }

  if (!Value.Check(ApplicationPayloadSchema, value)) {
    throw validationError(schemaIssues(value));
  }
  const payload = value as ApplicationPayload;
  const issues: IntakeValidationIssue[] = [];

  const birthdate = normalizeDate(payload.personal.birthdate);
  const now = options.now ?? new Date();
  if (!birthdate || new Date(`${birthdate}T00:00:00.000Z`).getTime() > now.getTime()) {
    issues.push({
      field: "personal.birthdate",
      code: "invalid_date",
      message: "Некорректная дата рождения.",
    });
  }

  if (birthdate) {
    const minimumAge = payload.application.applicantType === "student" ? 16 : 18;
    if (ageOnDate(birthdate, now) < minimumAge) {
      issues.push({
        field: "personal.birthdate",
        code: "minimum_age",
        message: `Минимальный возраст для выбранного маршрута — ${minimumAge} лет.`,
      });
    }
  }

  const email = payload.personal.email.trim().toLocaleLowerCase("en-US");
  if (!EMAIL_PATTERN.test(email)) {
    issues.push({ field: "personal.email", code: "invalid", message: "Некорректный email." });
  }

  const phoneE164 = normalizePhone(payload.personal.phone);
  if (!phoneE164) {
    issues.push({
      field: "personal.phone",
      code: "invalid",
      message: "Некорректный номер телефона.",
    });
  }

  const acceptedAt = normalizeInstant(payload.consents.acceptedAt);
  const privacyPolicyVersion = nullableText(payload.consents.privacyPolicyVersion);
  if (payload.consents.acceptedAt && !acceptedAt) {
    issues.push({
      field: "consents.acceptedAt",
      code: "invalid_datetime",
      message: "Некорректное время принятия политики.",
    });
  }
  if (options.requireConsentEvidence && !privacyPolicyVersion) {
    issues.push({
      field: "consents.privacyPolicyVersion",
      code: "required",
      message: "Версия политики конфиденциальности обязательна.",
    });
  }
  if (options.requireConsentEvidence && !payload.consents.acceptedAt) {
    issues.push({
      field: "consents.acceptedAt",
      code: "required",
      message: "Время принятия политики обязательно.",
    });
  }
  if (Boolean(privacyPolicyVersion) !== Boolean(acceptedAt)) {
    issues.push({
      field: privacyPolicyVersion ? "consents.acceptedAt" : "consents.privacyPolicyVersion",
      code: "paired_fields",
      message: "Версия политики и время принятия должны передаваться вместе.",
    });
  }

  const resumeFileBindingToken = nullableText(payload.attachments.resumeFileBindingToken);
  if (options.requireUploadBinding && !resumeFileBindingToken) {
    issues.push({
      field: "attachments.resumeFileBindingToken",
      code: "required",
      message: "Одноразовый ключ привязки загруженного резюме обязателен.",
    });
  }

  const hasVacancyId = Boolean(nullableText(payload.application.vacancyId));
  const hasVacancySector = Boolean(payload.application.vacancySector);
  if (hasVacancyId !== hasVacancySector) {
    issues.push({
      field: "application.vacancyId",
      code: "paired_fields",
      message: "vacancyId и vacancySector должны передаваться вместе.",
    });
  }

  if (payload.application.applicantType === "relocation") {
    const salary = normalizeSalary(payload.application.wishSalary);
    if (
      typeof payload.application.wishSalary !== "undefined" &&
      payload.application.wishSalary !== "" &&
      salary === null
    ) {
      issues.push({
        field: "application.wishSalary",
        code: "invalid",
        message: "Желаемый доход должен быть целым числом в рублях.",
      });
    }
  } else {
    const profile = payload.application.studentProfile;
    const needsPracticePeriod = profile.status !== "graduated";
    if (needsPracticePeriod && !profile.practicePeriod) {
      issues.push({
        field: "application.studentProfile.practicePeriod",
        code: "required",
        message: "Для текущего курса укажите период ближайшей практики.",
      });
    }
    if (!needsPracticePeriod && profile.practicePeriod) {
      issues.push({
        field: "application.studentProfile.practicePeriod",
        code: "forbidden_for_status",
        message: "Для выпускника период практики не передаётся.",
      });
    }
    if (profile.practicePeriod) {
      const { start, end } = profile.practicePeriod;
      if (!MONTH_PATTERN.test(start) || !MONTH_PATTERN.test(end) || end < start) {
        issues.push({
          field: "application.studentProfile.practicePeriod",
          code: "invalid_range",
          message: "Некорректный период практики.",
        });
      }
    }
  }

  if (issues.length) {
    throw validationError(issues);
  }

  const meta = normalizeMeta(payload.meta);
  const common = {
    referralCode: nullableText(payload.application.referralCode),
    region: collapseWhitespace(payload.application.region),
    comment: nullableText(payload.application.comment),
    vacancyId: nullableText(payload.application.vacancyId) ?? meta.entryPoint.vacancyId,
    vacancySector: payload.application.vacancySector ?? meta.entryPoint.vacancySector,
  };

  const application =
    payload.application.applicantType === "relocation"
      ? {
          ...common,
          applicantType: "relocation" as const,
          sphere: collapseWhitespace(payload.application.sphere),
          wishPost: collapseWhitespace(payload.application.wishPost),
          wishSalaryRub: normalizeSalary(payload.application.wishSalary),
        }
      : {
          ...common,
          applicantType: "student" as const,
          studentProfile: {
            institution: collapseWhitespace(payload.application.studentProfile.institution),
            specialty: collapseWhitespace(payload.application.studentProfile.specialty),
            graduationYear: payload.application.studentProfile.graduationYear,
            status: payload.application.studentProfile.status,
            practicePeriod: payload.application.studentProfile.practicePeriod
              ? {
                  start: payload.application.studentProfile.practicePeriod.start,
                  end: payload.application.studentProfile.practicePeriod.end,
                }
              : null,
          },
        };

  return {
    schemaVersion: payload.schemaVersion ?? "1-compat",
    personal: {
      surname: collapseWhitespace(payload.personal.surname),
      name: collapseWhitespace(payload.personal.name),
      middlename: nullableText(payload.personal.middlename),
      birthdate: birthdate as string,
      email,
      phoneE164: phoneE164 as string,
    },
    application,
    consent: {
      privacyAccepted: true,
      privacyPolicyVersion,
      acceptedAt,
      evidence: acceptedAt ? "client" : "server-received-compat",
    },
    attachments: {
      resumeFileId: payload.attachments.resumeFileId,
      resumeFileBindingToken,
    },
    meta,
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function hashCanonicalJson(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

export function sha256Bytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
