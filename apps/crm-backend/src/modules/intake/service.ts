import { Value } from "@sinclair/typebox/value";
import { assertUploadLimitWithinStorageCeiling } from "../../common/upload-policy.js";
import { IntakeError } from "./errors.js";
import { hashCanonicalJson, normalizeApplicationPayload, sha256Bytes } from "./normalize.js";
import type { IntakeRepositoryPort, IntakeStoragePort } from "./ports.js";
import {
  type ApplicationReceipt,
  ApplicationReceiptSchema,
  MapPointListSchema,
  SphereListSchema,
  type UploadReceipt,
  UploadReceiptSchema,
  type VacancyPage,
  VacancyPageSchema,
  type VacancyQuery,
  VacancySchema,
} from "./schemas.js";

const DEFAULT_PAGE_LIMIT = 20;

type UploadKind = "pdf" | "doc" | "docx" | "rtf";

const MEDIA_TYPES: Readonly<Record<UploadKind, ReadonlySet<string>>> = {
  pdf: new Set(["application/pdf", "application/octet-stream"]),
  doc: new Set(["application/msword", "application/octet-stream"]),
  docx: new Set([
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/zip",
    "application/octet-stream",
  ]),
  rtf: new Set([
    "application/rtf",
    "application/x-rtf",
    "text/rtf",
    "text/richtext",
    "application/octet-stream",
  ]),
};

const PRIMARY_MEDIA_TYPE: Readonly<Record<UploadKind, string>> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  rtf: "application/rtf",
};

export interface IntakeServiceDependencies {
  readonly repository: IntakeRepositoryPort;
  readonly storage: IntakeStoragePort;
  readonly maxUploadBytes: number;
  readonly now?: () => Date;
}

export interface IdempotentServiceResult<T> {
  readonly value: T;
  readonly replayed: boolean;
}

export interface StorePublicUploadInput {
  readonly idempotencyKey: string;
  readonly requestId: string;
  readonly fileName: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

export interface CreatePublicApplicationInput {
  readonly idempotencyKey: string;
  readonly requestId: string;
  readonly payload: unknown;
  readonly requireConsentEvidence?: boolean;
  readonly requireUploadBinding?: boolean;
}

export interface IntakeService {
  listSpheres(): Promise<{ readonly items: Awaited<ReturnType<IntakeRepositoryPort["listSpheres"]>> }>;
  listMapPoints(): Promise<{ readonly items: Awaited<ReturnType<IntakeRepositoryPort["listMapPoints"]>> }>;
  listVacancies(query: VacancyQuery): Promise<VacancyPage>;
  storeUpload(input: StorePublicUploadInput): Promise<IdempotentServiceResult<UploadReceipt>>;
  createApplication(
    input: CreatePublicApplicationInput,
  ): Promise<IdempotentServiceResult<ApplicationReceipt>>;
}

function cleanFileName(value: string): string {
  const leaf = value.replaceAll("\0", "").split(/[\\/]/u).at(-1) ?? "";
  return [...leaf.normalize("NFC")]
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 31 && codePoint !== 127;
    })
    .join("")
    .trim();
}

function fileExtension(fileName: string): UploadKind | null {
  const extension = /\.([a-z0-9]+)$/iu.exec(fileName)?.[1]?.toLocaleLowerCase("en-US");
  return extension === "pdf" || extension === "doc" || extension === "docx" || extension === "rtf"
    ? extension
    : null;
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

function isDocx(bytes: Uint8Array): boolean {
  if (
    !startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) &&
    !startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]) &&
    !startsWith(bytes, [0x50, 0x4b, 0x07, 0x08])
  ) {
    return false;
  }
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return buffer.includes(Buffer.from("[Content_Types].xml")) && buffer.includes(Buffer.from("word/"));
}

function detectUploadKind(bytes: Uint8Array): UploadKind | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return "pdf";
  }
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return "doc";
  }
  if (isDocx(bytes)) {
    return "docx";
  }
  const prefix = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, 16))
    .toString("ascii")
    .replace(/^\s+/u, "");
  return prefix.startsWith("{\\rtf") ? "rtf" : null;
}

function normalizeMediaType(value: string): string {
  return value.split(";", 1)[0]?.trim().toLocaleLowerCase("en-US") ?? "";
}

function validateUpload(
  input: StorePublicUploadInput,
  maxUploadBytes: number,
): {
  readonly fileName: string;
  readonly mediaType: string;
  readonly kind: UploadKind;
} {
  if (input.bytes.byteLength === 0) {
    throw new IntakeError(422, "validation_error", "Validation failed", [
      { field: "file", code: "empty", message: "Файл пуст." },
    ]);
  }
  if (input.bytes.byteLength > maxUploadBytes) {
    throw new IntakeError(413, "payload_too_large", `Файл превышает лимит ${maxUploadBytes} байт.`);
  }

  const fileName = cleanFileName(input.fileName);
  if (!fileName || fileName.length > 255) {
    throw new IntakeError(422, "validation_error", "Validation failed", [
      { field: "file", code: "invalid_name", message: "Некорректное имя файла." },
    ]);
  }

  const extension = fileExtension(fileName);
  const detectedKind = detectUploadKind(input.bytes);
  const suppliedMediaType = normalizeMediaType(input.mediaType);
  if (!extension || !detectedKind || extension !== detectedKind) {
    throw new IntakeError(415, "unsupported_media_type", "Поддерживаются PDF, DOC, DOCX и RTF.", [
      {
        field: "file",
        code: "content_mismatch",
        message: "Расширение файла не соответствует его содержимому.",
      },
    ]);
  }
  if (suppliedMediaType && !MEDIA_TYPES[extension].has(suppliedMediaType)) {
    throw new IntakeError(415, "unsupported_media_type", "Некорректный MIME-тип файла.", [
      { field: "file", code: "media_type", message: "MIME-тип не соответствует формату файла." },
    ]);
  }

  return {
    fileName,
    mediaType: suppliedMediaType || PRIMARY_MEDIA_TYPE[extension],
    kind: extension,
  };
}

async function validateVacancyBinding(
  repository: IntakeRepositoryPort,
  input: Parameters<IntakeRepositoryPort["createApplication"]>[0]["input"],
): Promise<void> {
  const { vacancyId, vacancySector, applicantType } = input.application;
  if (!vacancyId && !vacancySector) {
    return;
  }

  const issues: Array<{ field: string; code: string; message: string }> = [];
  if (!vacancyId) {
    issues.push({
      field: "application.vacancyId",
      code: "paired_fields",
      message: "vacancyId обязателен вместе с vacancySector.",
    });
  }
  if (!vacancySector) {
    issues.push({
      field: "application.vacancySector",
      code: "paired_fields",
      message: "vacancySector обязателен вместе с vacancyId.",
    });
  }
  if (issues.length || !vacancyId || !vacancySector) {
    throw new IntakeError(422, "validation_error", "Validation failed", issues);
  }

  const vacancy = await repository.findPublishedVacancyById(vacancyId);
  if (!vacancy) {
    throw new IntakeError(422, "validation_error", "Validation failed", [
      {
        field: "application.vacancyId",
        code: "not_published",
        message: "Указанная вакансия не опубликована или не существует.",
      },
    ]);
  }
  if (!Value.Check(VacancySchema, vacancy)) {
    throw adapterContractError("PublicVacancy");
  }
  if (vacancy.sector !== vacancySector) {
    issues.push({
      field: "application.vacancySector",
      code: "vacancy_mismatch",
      message: "Сектор не соответствует опубликованной вакансии.",
    });
  }
  if (vacancy.applicantType !== applicantType) {
    issues.push({
      field: "application.applicantType",
      code: "vacancy_mismatch",
      message: "Маршрут кандидата не соответствует опубликованной вакансии.",
    });
  }
  if (issues.length) {
    throw new IntakeError(422, "validation_error", "Validation failed", issues);
  }
}

function applicationRequestHash(
  input: Parameters<IntakeRepositoryPort["createApplication"]>[0]["input"],
): string {
  const { resumeFileBindingToken: _credential, ...safeAttachments } = input.attachments;
  return hashCanonicalJson({ ...input, attachments: safeAttachments });
}

function adapterContractError(contract: string): IntakeError {
  return new IntakeError(
    500,
    "adapter_contract_error",
    `Адаптер вернул данные, не соответствующие контракту ${contract}.`,
  );
}

function resolveIdempotentResult<T>(
  result: { readonly state: "created" | "replayed"; readonly value: T } | { readonly state: "conflict" },
): IdempotentServiceResult<T> {
  if (result.state === "conflict") {
    throw new IntakeError(
      409,
      "idempotency_conflict",
      "Этот Idempotency-Key уже использован с другим содержимым запроса.",
    );
  }
  return { value: result.value, replayed: result.state === "replayed" };
}

export function createIntakeService(dependencies: IntakeServiceDependencies): IntakeService {
  const now = dependencies.now ?? (() => new Date());
  const maxUploadBytes = assertUploadLimitWithinStorageCeiling(
    dependencies.maxUploadBytes,
    "Public intake upload limit",
  );

  return {
    async listSpheres() {
      const response = { items: await dependencies.repository.listSpheres() };
      if (!Value.Check(SphereListSchema, response)) {
        throw adapterContractError("PublicSphereList");
      }
      return response;
    },

    async listMapPoints() {
      const response = { items: await dependencies.repository.listMapPoints() };
      if (!Value.Check(MapPointListSchema, response)) {
        throw adapterContractError("PublicMapPointList");
      }
      return response;
    },

    async listVacancies(query) {
      const limit = Math.min(
        100,
        Math.max(
          1,
          typeof query.limit === "string" ? Number(query.limit) : (query.limit ?? DEFAULT_PAGE_LIMIT),
        ),
      );
      const result = await dependencies.repository.listVacancies({
        sector: query.sector ?? null,
        cursor: query.cursor ?? null,
        limit,
      });
      const response = {
        items: [...result.items],
        page: {
          limit,
          nextCursor: result.nextCursor,
          hasMore: result.nextCursor !== null,
        },
      };
      if (!Value.Check(VacancyPageSchema, response)) {
        throw adapterContractError("PublicVacancyPage");
      }
      return response;
    },

    async storeUpload(input) {
      const validated = validateUpload(input, maxUploadBytes);
      const receivedAt = now().toISOString();
      const sha256 = sha256Bytes(input.bytes);
      const result = resolveIdempotentResult(
        await dependencies.storage.storeUpload({
          idempotencyKey: input.idempotencyKey,
          requestHash: hashCanonicalJson({
            fileName: validated.fileName,
            mediaType: validated.mediaType,
            kind: validated.kind,
            sha256,
          }),
          requestId: input.requestId,
          receivedAt,
          fileName: validated.fileName,
          mediaType: validated.mediaType,
          sha256,
          bytes: input.bytes,
        }),
      );
      if (!Value.Check(UploadReceiptSchema, result.value)) {
        throw adapterContractError("PublicUploadReceipt");
      }
      return result;
    },

    async createApplication(input) {
      const receivedAt = now().toISOString();
      const normalized = normalizeApplicationPayload(input.payload, {
        now: new Date(receivedAt),
        requireConsentEvidence: input.requireConsentEvidence ?? false,
        requireUploadBinding: input.requireUploadBinding ?? false,
      });
      await validateVacancyBinding(dependencies.repository, normalized);
      const result = resolveIdempotentResult(
        await dependencies.repository.createApplication({
          idempotencyKey: input.idempotencyKey,
          requestHash: applicationRequestHash(normalized),
          requestId: input.requestId,
          receivedAt,
          input: normalized,
          requireUploadBinding: input.requireUploadBinding ?? false,
        }),
      );
      if (!Value.Check(ApplicationReceiptSchema, result.value)) {
        throw adapterContractError("PublicApplicationReceipt");
      }
      return result;
    },
  };
}

export { DEFAULT_PAGE_LIMIT };
