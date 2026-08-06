import { createHash, createHmac } from "node:crypto";
import { AppError } from "../../common/errors.js";
import { boundedLimit, decodeCursor, encodeCursor, type Page } from "../../common/pagination.js";
import { assertUploadLimitWithinStorageCeiling } from "../../common/upload-policy.js";
import type { CrmActorContext } from "../crm/ports.js";
import type {
  Candidate360Provenance,
  CandidateDocument,
  CandidateDocumentContentState,
  CandidateRecommender,
  DuplicateCandidate,
} from "./contracts.js";
import type {
  Candidate360AuthorizationPort,
  Candidate360MutationResult,
  Candidate360RepositoryPage,
  Candidate360RepositoryPort,
  Candidate360ResourceReference,
  Candidate360ServicePort,
  CandidateDocumentContentStorePort,
} from "./ports.js";
import { CANDIDATE_360_OPERATIONS, type Candidate360OperationKey } from "./registry.js";

export interface CreateCandidate360ServiceOptions {
  readonly repository: Candidate360RepositoryPort;
  readonly authorization: Candidate360AuthorizationPort;
  readonly cursorSigningKey: string;
  readonly contentStore?: CandidateDocumentContentStorePort;
  readonly maxDocumentContentBytes: number;
  readonly defaultPageSize?: number;
  readonly maximumPageSize?: number;
}

function blockedContentError(state: CandidateDocumentContentState): AppError {
  switch (state) {
    case "scan_pending":
      return new AppError(423, "document_scan_pending", "Содержимое недоступно до завершения проверки файла");
    case "rejected":
      return new AppError(423, "document_content_rejected", "Файл отклонён проверкой безопасности");
    case "scan_failed":
      return new AppError(423, "document_scan_failed", "Проверка безопасности файла не завершилась успешно");
    case "external_unavailable":
      return new AppError(
        503,
        "document_content_unavailable",
        "Для этого документа нет доступного защищённого содержимого",
      );
    case "available":
      return new AppError(500, "document_content_gate_violation", "Некорректное состояние документа");
  }
}

function assertExpectedVersion(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new AppError(422, "invalid_expected_version", "Ожидаемая версия должна быть больше нуля");
  }
}

function normalizeReason(value: string): string {
  const reason = value.trim();
  if (reason.length < 8 || reason.length > 2_000) {
    throw new AppError(422, "invalid_reason", "Причина должна содержать от 8 до 2000 символов", {
      errors: [{ field: "reason", code: "length", message: "Укажите содержательную причину" }],
    });
  }
  return reason;
}

function normalizeProvenance(value: Candidate360Provenance | undefined): Candidate360Provenance {
  if (!value) return { origin: "manual" };
  return {
    origin: value.origin,
    ...(value.sourceSystem ? { sourceSystem: value.sourceSystem.trim() } : {}),
    ...(value.sourceReference ? { sourceReference: value.sourceReference.trim() } : {}),
    ...(value.evidenceReferences
      ? { evidenceReferences: [...new Set(value.evidenceReferences.map((item) => item.trim()))] }
      : {}),
  };
}

function pageSigningKey(
  rootKey: string,
  operation: Candidate360OperationKey,
  actor: CrmActorContext,
  filters: Readonly<Record<string, unknown>>,
): string {
  const normalizedFilters = Object.entries(filters)
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return createHmac("sha256", rootKey)
    .update(operation)
    .update("\0")
    .update(actor.userAccountId)
    .update("\0")
    .update(JSON.stringify(normalizedFilters))
    .digest("hex");
}

function mapPage<T>(page: Candidate360RepositoryPage<T>, limit: number, signingKey: string): Page<T> {
  if (page.hasMore !== (page.nextCursor !== null)) {
    throw new AppError(
      500,
      "pagination_contract_violation",
      "Репозиторий вернул несогласованный курсор пагинации",
    );
  }
  return {
    items: [...page.items],
    page: {
      limit,
      nextCursor: page.nextCursor ? encodeCursor(page.nextCursor, signingKey) : null,
      hasMore: page.hasMore,
    },
  };
}

function handleMutationResult<T>(
  result: Candidate360MutationResult<T>,
  expectedVersion: number,
  resourceName: string,
): T {
  switch (result.kind) {
    case "succeeded":
      return result.value;
    case "not_found":
      throw new AppError(404, "not_found", `${resourceName} не найден`);
    case "version_conflict":
      throw new AppError(409, "version_conflict", "Объект уже изменён другим запросом", {
        details: { expectedVersion, currentVersion: result.currentVersion },
      });
    case "state_conflict":
      throw new AppError(409, "state_conflict", "Текущее состояние не допускает операцию", {
        details: {
          expectedVersion,
          currentVersion: result.currentVersion,
          currentState: result.currentState,
        },
      });
    case "scan_not_clean":
      throw new AppError(
        423,
        "scan_not_clean",
        "Документ нельзя проверить до успешной проверки безопасности файла",
        {
          details: {
            currentVersion: result.currentVersion,
            scanState: result.scanState,
          },
        },
      );
    case "employee_identity_conflict":
      throw new AppError(
        409,
        "employee_identity_merge_forbidden",
        "Карточка сотрудника не может участвовать в объединении кандидатов",
        { details: { personIds: [...result.personIds] } },
      );
    case "invalid_survivor":
      throw new AppError(
        422,
        "invalid_survivor",
        "Основная карточка должна быть одной из двух карточек выбранного дубля",
      );
    case "already_linked":
      throw new AppError(409, "recommender_already_linked", "Такая активная связь уже существует", {
        details: { linkId: result.linkId, currentVersion: result.currentVersion },
      });
  }
}

export function createCandidate360Service(
  options: CreateCandidate360ServiceOptions,
): Candidate360ServicePort {
  if (options.cursorSigningKey.length < 32) {
    throw new Error("Candidate 360 cursor signing key must contain at least 32 characters");
  }
  const defaultPageSize = boundedLimit(options.defaultPageSize, 50, 200);
  const maximumPageSize = boundedLimit(options.maximumPageSize, 200, 200);
  if (defaultPageSize > maximumPageSize) {
    throw new Error("Candidate 360 default page size cannot exceed maximum page size");
  }
  const maxDocumentContentBytes = assertUploadLimitWithinStorageCeiling(
    options.maxDocumentContentBytes,
    "Candidate document content limit",
  );

  const authorize = async (
    operationKey: Candidate360OperationKey,
    actor: CrmActorContext,
    resource?: Candidate360ResourceReference,
  ) => {
    const operation = CANDIDATE_360_OPERATIONS[operationKey];
    return options.authorization.authorize({ actor, operation, ...(resource ? { resource } : {}) });
  };

  const service: Candidate360ServicePort = {
    async listDuplicateCandidates(actor, query) {
      const access = await authorize("duplicates.list", actor);
      const filters = {
        state: query.state ?? "open",
        personId: query.personId,
        minimumConfidence: query.minimumConfidence,
      } as const;
      const signingKey = pageSigningKey(options.cursorSigningKey, "duplicates.list", actor, filters);
      const limit = boundedLimit(query.limit, defaultPageSize, maximumPageSize);
      const result = await options.repository.listDuplicateCandidates(access, {
        state: filters.state,
        cursor: decodeCursor(query.cursor, signingKey),
        limit,
        ...(filters.personId ? { personId: filters.personId } : {}),
        ...(filters.minimumConfidence === undefined ? {} : { minimumConfidence: filters.minimumConfidence }),
      });
      return mapPage<DuplicateCandidate>(result, limit, signingKey);
    },

    async listCandidateDocuments(actor, personId, query) {
      const access = await authorize("documents.list", actor, { type: "person", id: personId });
      const filters = {
        personId,
        documentKind: query.documentKind,
        reviewState: query.reviewState,
      } as const;
      const signingKey = pageSigningKey(options.cursorSigningKey, "documents.list", actor, filters);
      const limit = boundedLimit(query.limit, defaultPageSize, maximumPageSize);
      const result = await options.repository.listCandidateDocuments(access, {
        personId,
        cursor: decodeCursor(query.cursor, signingKey),
        limit,
        ...(query.documentKind ? { documentKind: query.documentKind } : {}),
        ...(query.reviewState ? { reviewState: query.reviewState } : {}),
      });
      return mapPage<CandidateDocument>(result, limit, signingKey);
    },

    async getCandidateDocument(actor, documentId) {
      const access = await authorize("documents.get", actor, {
        type: "candidate_document",
        id: documentId,
      });
      const document = await options.repository.getCandidateDocument(access, documentId);
      if (!document) throw new AppError(404, "not_found", "Документ кандидата не найден");
      return document;
    },

    async getCandidateDocumentContent(actor, documentId) {
      const access = await authorize("documents.content", actor, {
        type: "candidate_document",
        id: documentId,
      });
      const descriptor = await options.repository.getCandidateDocumentContentAccess(access, documentId);
      if (descriptor.kind === "not_found") {
        throw new AppError(404, "not_found", "Документ кандидата не найден");
      }
      if (descriptor.kind === "blocked") throw blockedContentError(descriptor.state);
      if (!options.contentStore) {
        throw new AppError(
          503,
          "document_content_store_unavailable",
          "Хранилище содержимого документов не настроено",
        );
      }
      if (descriptor.byteSize > maxDocumentContentBytes) {
        throw new AppError(413, "document_content_too_large", "Размер документа превышает лимит выдачи");
      }

      let bytes: Uint8Array;
      try {
        bytes = await options.contentStore.read(descriptor.storageKey, maxDocumentContentBytes);
      } catch {
        throw new AppError(503, "document_content_unavailable", "Содержимое документа временно недоступно");
      }
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (bytes.byteLength !== descriptor.byteSize || digest !== descriptor.sha256) {
        throw new AppError(
          503,
          "document_content_integrity_failed",
          "Проверка целостности содержимого документа не пройдена",
        );
      }
      const accessRecorded = await options.repository.recordCandidateDocumentContentAccess(
        actor,
        access,
        documentId,
      );
      if (!accessRecorded) {
        throw new AppError(
          423,
          "document_content_gate_changed",
          "Состояние проверки документа изменилось; повторите запрос",
        );
      }
      return {
        documentId,
        originalName: descriptor.originalName,
        mediaType: descriptor.mediaType,
        byteSize: descriptor.byteSize,
        sha256: descriptor.sha256,
        bytes,
      };
    },

    async listCandidateRecommenders(actor, candidatePersonId, query) {
      const access = await authorize("recommenders.list", actor, {
        type: "person",
        id: candidatePersonId,
      });
      const filters = { candidatePersonId, state: query.state ?? "active" } as const;
      const signingKey = pageSigningKey(options.cursorSigningKey, "recommenders.list", actor, filters);
      const limit = boundedLimit(query.limit, defaultPageSize, maximumPageSize);
      const result = await options.repository.listCandidateRecommenders(access, {
        candidatePersonId,
        state: filters.state,
        cursor: decodeCursor(query.cursor, signingKey),
        limit,
      });
      return mapPage<CandidateRecommender>(result, limit, signingKey);
    },

    async mergeCandidate(actor, duplicateCandidateId, expectedVersion, body) {
      assertExpectedVersion(expectedVersion);
      const access = await authorize("duplicates.merge", actor, {
        type: "candidate_duplicate",
        id: duplicateCandidateId,
      });
      const result = await options.repository.mergeCandidate({
        duplicateCandidateId,
        survivorPersonId: body.survivorPersonId,
        expectedVersion,
        reason: normalizeReason(body.reason),
        provenance: normalizeProvenance(body.provenance),
        actor,
        access,
      });
      return handleMutationResult(result, expectedVersion, "Возможный дубль");
    },

    async linkRecommender(actor, candidatePersonId, expectedCandidateVersion, body) {
      assertExpectedVersion(expectedCandidateVersion);
      if (candidatePersonId === body.recommenderPersonId) {
        throw new AppError(422, "self_recommender_forbidden", "Кандидат не может рекомендовать сам себя");
      }
      const access = await authorize("recommenders.link", actor, {
        type: "person",
        id: candidatePersonId,
      });
      const result = await options.repository.linkRecommender({
        candidatePersonId,
        recommenderPersonId: body.recommenderPersonId,
        relationshipType: body.relationshipType,
        expectedCandidateVersion,
        reason: normalizeReason(body.reason),
        provenance: normalizeProvenance(body.provenance),
        actor,
        access,
      });
      return handleMutationResult(result, expectedCandidateVersion, "Кандидат или рекомендатель");
    },

    async reviewDocument(actor, documentId, expectedVersion, body) {
      assertExpectedVersion(expectedVersion);
      const access = await authorize("documents.review", actor, {
        type: "candidate_document",
        id: documentId,
      });
      const result = await options.repository.reviewDocument({
        documentId,
        decision: body.decision,
        expectedVersion,
        reason: normalizeReason(body.reason),
        provenance: normalizeProvenance(body.provenance),
        actor,
        access,
      });
      return handleMutationResult(result, expectedVersion, "Документ кандидата");
    },
  };
  return Object.freeze(service);
}
