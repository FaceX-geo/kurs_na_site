import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Kysely, Transaction } from "kysely";
import { newPublicId, newUuid } from "../../common/id.js";
import { decodeCursor, encodeCursor } from "../../common/pagination.js";
import type { AppConfig } from "../../config/env.js";
import type { Database } from "../../db/types.js";
import { appendAuditEvent } from "../platform/audit.js";
import { IntakeError } from "./errors.js";
import type { QuarantineObjectStore } from "./object-storage.js";
import type {
  CreateApplicationCommand,
  CursorPage,
  IdempotentWriteResult,
  IntakeRepositoryPort,
  IntakeStoragePort,
  PublicVacancyQuery,
  StoreUploadCommand,
} from "./ports.js";
import type { ApplicationReceipt, MapPoint, Sphere, UploadReceipt, Vacancy } from "./schemas.js";
import { issueUploadBinding, keyApplicationRequestHash, verifyUploadBinding } from "./upload-binding.js";

interface JsonItems<T> {
  items?: T[];
}

type StoredUploadReceipt = Omit<UploadReceipt, "bindingToken">;

type IdempotencyClaim<T> =
  | { readonly state: "replayed"; readonly value: T; readonly resourceId: string | null }
  | { readonly state: "conflict" };

interface ReservedUpload {
  readonly id: string;
  readonly publicId: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly storageKey: string;
  readonly fileName: string;
  readonly mediaType: string;
  readonly byteSize: number;
  readonly sha256: string;
  readonly bindingTokenHash: string;
  readonly bindingKeyVersion: number;
  readonly createdAt: Date;
}

type UploadReservationResult =
  | { readonly state: "reserved"; readonly reservation: ReservedUpload }
  | { readonly state: "replayed"; readonly value: UploadReceipt }
  | { readonly state: "conflict" };

export interface UploadReconciliationOptions {
  readonly staleBefore: Date;
  readonly cleanupRetryBefore: Date;
  readonly batchSize: number;
}

export interface UploadReconciliationResult {
  readonly claimed: number;
  readonly removed: number;
  readonly failed: number;
}

function piiHash(value: string, key: string): string {
  return createHmac("sha256", key).update(value).digest("hex");
}

function responseFromRecord<T>(value: unknown): T {
  return value as T;
}

export class PostgresIntakeAdapter implements IntakeRepositoryPort, IntakeStoragePort {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly config: AppConfig,
    private readonly objectStore: QuarantineObjectStore,
  ) {}

  async listSpheres(): Promise<readonly Sphere[]> {
    return this.readItems<Sphere>("spheres.json");
  }

  async listMapPoints(): Promise<readonly MapPoint[]> {
    return this.readItems<MapPoint>("map-points.json");
  }

  async listVacancies(query: PublicVacancyQuery): Promise<CursorPage<Vacancy>> {
    const cursor = decodeCursor(query.cursor ?? undefined, this.config.cursorSigningKey);
    const vacancies = (await this.readItems<Vacancy>("vacancies.json"))
      .filter((vacancy) => vacancy.published && (!query.sector || vacancy.sector === query.sector))
      .sort((left, right) => left.id.localeCompare(right.id));
    const afterCursor = cursor ? vacancies.filter((vacancy) => vacancy.id > cursor.id) : vacancies;
    const page = afterCursor.slice(0, query.limit + 1);
    const hasMore = page.length > query.limit;
    const items = page.slice(0, query.limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        hasMore && last
          ? encodeCursor({ createdAt: "1970-01-01T00:00:00.000Z", id: last.id }, this.config.cursorSigningKey)
          : null,
    };
  }

  async findPublishedVacancyById(vacancyId: string): Promise<Vacancy | null> {
    const matches = (await this.readItems<Vacancy>("vacancies.json")).filter(
      (vacancy) => vacancy.published && vacancy.id === vacancyId,
    );
    if (matches.length > 1) {
      throw new IntakeError(
        500,
        "vacancy_registry_conflict",
        "Реестр вакансий содержит повторяющийся опубликованный идентификатор.",
      );
    }
    return matches[0] ?? null;
  }

  async createApplication(
    command: CreateApplicationCommand,
  ): Promise<IdempotentWriteResult<ApplicationReceipt>> {
    return this.db.transaction().execute(async (transaction) => {
      const replay = await this.claimIdempotency<ApplicationReceipt>(
        transaction,
        "public.application.create",
        command.idempotencyKey,
        keyApplicationRequestHash(
          command.requestHash,
          command.input.attachments.resumeFileBindingToken,
          this.config.credentialDelivery.tokenSecret,
        ),
      );
      if (replay) {
        return replay.state === "replayed" ? { state: "replayed", value: replay.value } : replay;
      }

      const upload = await transaction
        .selectFrom("intake.upload")
        .select([
          "id",
          "linked_submission_id",
          "expires_at",
          "scan_state",
          "binding_token_hash",
          "binding_key_version",
        ])
        .where("public_id", "=", command.input.attachments.resumeFileId)
        .forUpdate()
        .executeTakeFirst();
      if (
        !upload ||
        new Date(upload.expires_at) <= new Date(command.receivedAt) ||
        upload.scan_state === "rejected"
      ) {
        throw new IntakeError(422, "validation_error", "Validation failed", [
          { field: "attachments.resumeFileId", code: "invalid", message: "Файл резюме недоступен." },
        ]);
      }
      if (upload.linked_submission_id) {
        throw new IntakeError(409, "upload_already_linked", "Файл уже связан с другой заявкой.");
      }
      const bindingToken = command.input.attachments.resumeFileBindingToken;
      if (
        bindingToken &&
        (!upload.binding_token_hash ||
          upload.binding_key_version === null ||
          !verifyUploadBinding(
            bindingToken,
            upload.binding_token_hash,
            upload.binding_key_version,
            this.config.credentialDelivery.tokenSecret,
          ))
      ) {
        throw new IntakeError(422, "validation_error", "Validation failed", [
          {
            field: "attachments.resumeFileBindingToken",
            code: "invalid",
            message: "Ключ привязки загруженного резюме недействителен.",
          },
        ]);
      }
      if (command.requireUploadBinding && !bindingToken) {
        throw new IntakeError(422, "validation_error", "Validation failed", [
          {
            field: "attachments.resumeFileBindingToken",
            code: "required",
            message: "Ключ привязки загруженного резюме обязателен.",
          },
        ]);
      }

      const submissionId = newUuid();
      const publicId = newPublicId("application");
      const createdAt = new Date(command.receivedAt);
      const sourceCode = command.input.meta.source || "web";
      await transaction
        .insertInto("intake.submission")
        .values({
          id: submissionId,
          public_id: publicId,
          schema_version: command.input.schemaVersion,
          applicant_type: command.input.application.applicantType,
          payload: {
            ...command.input,
            attachments: { resumeFileId: command.input.attachments.resumeFileId },
          },
          normalized_email_hash: piiHash(command.input.personal.email, this.config.piiHashingKey),
          normalized_phone_hash: piiHash(command.input.personal.phoneE164, this.config.piiHashingKey),
          consent_policy_version: command.input.consent.privacyPolicyVersion,
          consent_accepted_at: command.input.consent.acceptedAt
            ? new Date(command.input.consent.acceptedAt)
            : null,
          source_code: sourceCode,
          entry_point_code: command.input.meta.entryPoint.code,
          vacancy_id: command.input.application.vacancyId,
          status: "received",
          routed_case_id: null,
          created_at: createdAt,
          updated_at: createdAt,
        })
        .execute();
      await transaction
        .updateTable("intake.upload")
        .set({ linked_submission_id: submissionId, binding_consumed_at: createdAt })
        .where("id", "=", upload.id)
        .execute();

      const eventId = newUuid();
      await transaction
        .insertInto("platform.outbox_event")
        .values({
          id: eventId,
          topic: "intake.application.received.v1",
          aggregate_type: "intake_submission",
          aggregate_id: submissionId,
          payload: { submissionId, schemaVersion: command.input.schemaVersion },
          idempotency_key: `intake.application.received:${submissionId}`,
          occurred_at: createdAt,
          available_at: createdAt,
          attempt_count: 0,
          locked_at: null,
          locked_by: null,
          delivered_at: null,
          last_error_code: null,
        })
        .execute();

      await appendAuditEvent(transaction, {
        eventType: "intake.application.received",
        actorType: "public_intake_client",
        subjectType: "intake_submission",
        subjectId: submissionId,
        requestId: command.requestId,
        afterState: { status: "received" },
        metadata: { sourceCode, applicantType: command.input.application.applicantType },
        policyVersion: command.input.consent.privacyPolicyVersion,
        occurredAt: createdAt,
      });

      const receipt: ApplicationReceipt = {
        applicationId: publicId,
        status: "received",
        createdAt: createdAt.toISOString(),
      };
      await this.completeIdempotency(
        transaction,
        "public.application.create",
        command.idempotencyKey,
        201,
        receipt,
        submissionId,
      );
      return { state: "created", value: receipt };
    });
  }

  async storeUpload(command: StoreUploadCommand): Promise<IdempotentWriteResult<UploadReceipt>> {
    const reservation = await this.reserveUpload(command);
    if (reservation.state !== "reserved") {
      return reservation.state === "replayed" ? { state: "replayed", value: reservation.value } : reservation;
    }

    await this.objectStore.put(
      reservation.reservation.storageKey,
      command.bytes,
      reservation.reservation.mediaType,
    );
    // Never delete here: COMMIT acknowledgement may be ambiguous. The durable reservation lets an
    // exact retry resume safely; the bounded reconciler owns deletion of stale unreferenced objects.
    return this.finalizeReservedUpload(reservation.reservation);
  }

  async reconcileAbandonedUploadObjects(
    options: UploadReconciliationOptions,
  ): Promise<UploadReconciliationResult> {
    if (!Number.isSafeInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 500) {
      throw new Error("Upload reconciliation batch size must be between 1 and 500");
    }
    const claims = await this.db.transaction().execute(async (transaction) => {
      const candidates = await transaction
        .selectFrom("intake.upload_reservation")
        .select(["id", "idempotency_key", "request_hash", "storage_key"])
        .where((expression) =>
          expression.or([
            expression.and([
              expression("state", "=", "reserved"),
              expression("updated_at", "<", options.staleBefore),
            ]),
            expression.and([
              expression("state", "=", "cleanup_pending"),
              expression("updated_at", "<", options.cleanupRetryBefore),
            ]),
          ]),
        )
        .orderBy("updated_at", "asc")
        .orderBy("id", "asc")
        .limit(options.batchSize)
        .forUpdate()
        .skipLocked()
        .execute();
      if (candidates.length > 0) {
        await transaction
          .updateTable("intake.upload_reservation")
          .set({ state: "cleanup_pending", updated_at: new Date() })
          .where(
            "id",
            "in",
            candidates.map((candidate) => candidate.id),
          )
          .execute();
      }
      return candidates;
    });

    let removed = 0;
    let failed = 0;
    for (const claim of claims) {
      try {
        await this.objectStore.remove(claim.storage_key);
        await this.db.transaction().execute(async (transaction) => {
          await transaction
            .updateTable("intake.upload_reservation")
            .set({ state: "abandoned", updated_at: new Date(), committed_at: null })
            .where("id", "=", claim.id)
            .where("state", "=", "cleanup_pending")
            .execute();
          await transaction
            .updateTable("platform.idempotency_record")
            .set({ state: "failed", locked_until: null, updated_at: new Date() })
            .where("scope", "=", "public.upload.create")
            .where("idempotency_key", "=", claim.idempotency_key)
            .where("request_hash", "=", claim.request_hash)
            .where("state", "=", "processing")
            .execute();
        });
        removed += 1;
      } catch {
        failed += 1;
      }
    }
    return { claimed: claims.length, removed, failed };
  }

  private async reserveUpload(command: StoreUploadCommand): Promise<UploadReservationResult> {
    return this.db.transaction().execute(async (transaction) => {
      const now = new Date();
      const inserted = await transaction
        .insertInto("platform.idempotency_record")
        .values({
          scope: "public.upload.create",
          idempotency_key: command.idempotencyKey,
          request_hash: command.requestHash,
          response_status: null,
          response_body: null,
          resource_id: null,
          state: "processing",
          locked_until: new Date(now.getTime() + 30_000),
          expires_at: new Date(now.getTime() + this.config.idempotencyTtlSeconds * 1000),
          created_at: now,
          updated_at: now,
        })
        .onConflict((conflict) => conflict.columns(["scope", "idempotency_key"]).doNothing())
        .returning("idempotency_key")
        .executeTakeFirst();

      if (inserted) {
        const uploadId = newUuid();
        const publicId = newPublicId("upload");
        const binding = issueUploadBinding(uploadId, publicId, this.config.credentialDelivery.tokenSecret);
        const storageKey = `quarantine/staged/${command.sha256.slice(0, 2)}/${uploadId}`;
        const createdAt = new Date(command.receivedAt);
        await transaction
          .insertInto("intake.upload_reservation")
          .values({
            id: uploadId,
            public_id: publicId,
            idempotency_key: command.idempotencyKey,
            request_hash: command.requestHash,
            storage_key: storageKey,
            original_name: command.fileName,
            media_type: command.mediaType,
            byte_size: command.bytes.byteLength,
            sha256: command.sha256,
            binding_token_hash: binding.tokenHash,
            binding_key_version: binding.keyVersion,
            state: "reserved",
            created_at: createdAt,
            updated_at: now,
            committed_at: null,
          })
          .execute();
        return {
          state: "reserved",
          reservation: {
            id: uploadId,
            publicId,
            idempotencyKey: command.idempotencyKey,
            requestHash: command.requestHash,
            storageKey,
            fileName: command.fileName,
            mediaType: command.mediaType,
            byteSize: command.bytes.byteLength,
            sha256: command.sha256,
            bindingTokenHash: binding.tokenHash,
            bindingKeyVersion: binding.keyVersion,
            createdAt,
          },
        };
      }

      const idempotency = await transaction
        .selectFrom("platform.idempotency_record")
        .select(["request_hash", "state", "response_body", "resource_id"])
        .where("scope", "=", "public.upload.create")
        .where("idempotency_key", "=", command.idempotencyKey)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (idempotency.request_hash !== command.requestHash) {
        return { state: "conflict" };
      }
      if (idempotency.state === "completed" && idempotency.response_body) {
        return {
          state: "replayed",
          value: await this.reconstructUploadReceipt(
            transaction,
            idempotency.resource_id,
            responseFromRecord<StoredUploadReceipt>(idempotency.response_body),
          ),
        };
      }
      if (idempotency.state !== "processing") {
        throw new IntakeError(
          409,
          "upload_reservation_expired",
          "Незавершённая загрузка истекла; повторите загрузку с новым Idempotency-Key.",
        );
      }

      const reservation = await transaction
        .selectFrom("intake.upload_reservation")
        .selectAll()
        .where("idempotency_key", "=", command.idempotencyKey)
        .forUpdate()
        .executeTakeFirst();
      if (!reservation || reservation.request_hash !== command.requestHash) {
        throw new IntakeError(500, "upload_lifecycle_invariant_failed", "Upload lifecycle is inconsistent.");
      }
      if (reservation.state !== "reserved") {
        throw new IntakeError(
          409,
          "upload_reservation_expired",
          "Незавершённая загрузка уже передана на очистку; повторите её с новым Idempotency-Key.",
        );
      }
      await transaction
        .updateTable("intake.upload_reservation")
        .set({ updated_at: now })
        .where("id", "=", reservation.id)
        .where("state", "=", "reserved")
        .execute();
      return {
        state: "reserved",
        reservation: {
          id: reservation.id,
          publicId: reservation.public_id,
          idempotencyKey: reservation.idempotency_key,
          requestHash: reservation.request_hash,
          storageKey: reservation.storage_key,
          fileName: reservation.original_name,
          mediaType: reservation.media_type,
          byteSize: Number(reservation.byte_size),
          sha256: reservation.sha256,
          bindingTokenHash: reservation.binding_token_hash,
          bindingKeyVersion: reservation.binding_key_version,
          createdAt: new Date(reservation.created_at),
        },
      };
    });
  }

  private async finalizeReservedUpload(
    reservation: ReservedUpload,
  ): Promise<IdempotentWriteResult<UploadReceipt>> {
    return this.db.transaction().execute(async (transaction) => {
      const idempotency = await transaction
        .selectFrom("platform.idempotency_record")
        .select(["request_hash", "state", "response_body", "resource_id"])
        .where("scope", "=", "public.upload.create")
        .where("idempotency_key", "=", reservation.idempotencyKey)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (idempotency.request_hash !== reservation.requestHash) {
        return { state: "conflict" };
      }
      if (idempotency.state === "completed" && idempotency.response_body) {
        return {
          state: "replayed",
          value: await this.reconstructUploadReceipt(
            transaction,
            idempotency.resource_id,
            responseFromRecord<StoredUploadReceipt>(idempotency.response_body),
          ),
        };
      }
      if (idempotency.state !== "processing") {
        throw new IntakeError(
          409,
          "upload_reservation_expired",
          "Незавершённая загрузка истекла; повторите загрузку с новым Idempotency-Key.",
        );
      }

      const lockedReservation = await transaction
        .selectFrom("intake.upload_reservation")
        .select(["state", "request_hash"])
        .where("id", "=", reservation.id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (lockedReservation.request_hash !== reservation.requestHash) {
        return { state: "conflict" };
      }
      if (lockedReservation.state !== "reserved") {
        throw new IntakeError(
          409,
          "upload_reservation_expired",
          "Незавершённая загрузка уже передана на очистку; повторите её с новым Idempotency-Key.",
        );
      }

      await transaction
        .insertInto("intake.upload")
        .values({
          id: reservation.id,
          public_id: reservation.publicId,
          storage_key: reservation.storageKey,
          original_name: reservation.fileName,
          media_type: reservation.mediaType,
          byte_size: reservation.byteSize,
          sha256: reservation.sha256,
          scan_state: "quarantined",
          linked_submission_id: null,
          binding_token_hash: reservation.bindingTokenHash,
          binding_key_version: reservation.bindingKeyVersion,
          binding_consumed_at: null,
          expires_at: new Date(reservation.createdAt.getTime() + 24 * 60 * 60_000),
          created_at: reservation.createdAt,
        })
        .execute();
      const committedAt = new Date();
      await transaction
        .updateTable("intake.upload_reservation")
        .set({ state: "committed", committed_at: committedAt, updated_at: committedAt })
        .where("id", "=", reservation.id)
        .where("state", "=", "reserved")
        .execute();

      const storedReceipt: StoredUploadReceipt = {
        fileId: reservation.publicId,
        name: reservation.fileName,
        size: reservation.byteSize,
        status: "quarantined",
      };
      await this.completeIdempotency(
        transaction,
        "public.upload.create",
        reservation.idempotencyKey,
        201,
        storedReceipt,
        reservation.id,
      );
      const binding = issueUploadBinding(
        reservation.id,
        reservation.publicId,
        this.config.credentialDelivery.tokenSecret,
      );
      if (
        binding.keyVersion !== reservation.bindingKeyVersion ||
        binding.tokenHash !== reservation.bindingTokenHash
      ) {
        throw new IntakeError(500, "upload_binding_invariant_failed", "Upload binding is inconsistent.");
      }
      return {
        state: "created",
        value: { ...storedReceipt, bindingToken: binding.token },
      };
    });
  }

  private async reconstructUploadReceipt(
    transaction: Transaction<Database>,
    resourceId: string | null,
    storedReceipt: StoredUploadReceipt,
  ): Promise<UploadReceipt> {
    if (!resourceId) {
      throw new IntakeError(
        409,
        "upload_binding_unavailable",
        "Повтор загрузки не может восстановить ключ привязки; загрузите файл заново.",
      );
    }
    const upload = await transaction
      .selectFrom("intake.upload")
      .select(["id", "public_id", "binding_token_hash", "binding_key_version"])
      .where("id", "=", resourceId)
      .executeTakeFirst();
    if (!upload?.binding_token_hash || upload.binding_key_version === null) {
      throw new IntakeError(
        409,
        "upload_binding_unavailable",
        "Повтор загрузки не может восстановить ключ привязки; загрузите файл заново.",
      );
    }
    const binding = issueUploadBinding(
      upload.id,
      upload.public_id,
      this.config.credentialDelivery.tokenSecret,
    );
    if (
      binding.keyVersion !== upload.binding_key_version ||
      binding.tokenHash !== upload.binding_token_hash
    ) {
      throw new IntakeError(
        409,
        "upload_binding_unavailable",
        "Ключ привязки загрузки больше не может быть восстановлен; загрузите файл заново.",
      );
    }
    return { ...storedReceipt, bindingToken: binding.token };
  }

  private async readItems<T>(fileName: string): Promise<readonly T[]> {
    try {
      const contents = await readFile(path.resolve(this.config.publicContentRoot, fileName), "utf8");
      const parsed = JSON.parse(contents) as JsonItems<T> | T[];
      return Array.isArray(parsed) ? parsed : (parsed.items ?? []);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  private async claimIdempotency<T>(
    transaction: Transaction<Database>,
    scope: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<IdempotencyClaim<T> | null> {
    const now = new Date();
    const inserted = await transaction
      .insertInto("platform.idempotency_record")
      .values({
        scope,
        idempotency_key: idempotencyKey,
        request_hash: requestHash,
        response_status: null,
        response_body: null,
        resource_id: null,
        state: "processing",
        locked_until: new Date(now.getTime() + 30_000),
        expires_at: new Date(now.getTime() + this.config.idempotencyTtlSeconds * 1000),
        created_at: now,
        updated_at: now,
      })
      .onConflict((conflict) => conflict.columns(["scope", "idempotency_key"]).doNothing())
      .returning("idempotency_key")
      .executeTakeFirst();
    if (inserted) {
      return null;
    }

    const existing = await transaction
      .selectFrom("platform.idempotency_record")
      .select(["request_hash", "state", "response_body", "resource_id"])
      .where("scope", "=", scope)
      .where("idempotency_key", "=", idempotencyKey)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (existing.request_hash !== requestHash || existing.state !== "completed" || !existing.response_body) {
      return { state: "conflict" };
    }
    return {
      state: "replayed",
      value: responseFromRecord<T>(existing.response_body),
      resourceId: existing.resource_id,
    };
  }

  private async completeIdempotency<T>(
    transaction: Transaction<Database>,
    scope: string,
    idempotencyKey: string,
    status: number,
    response: T,
    resourceId: string,
  ): Promise<void> {
    const result = await transaction
      .updateTable("platform.idempotency_record")
      .set({
        response_status: status,
        response_body: response,
        resource_id: resourceId,
        state: "completed",
        locked_until: null,
        updated_at: new Date(),
      })
      .where("scope", "=", scope)
      .where("idempotency_key", "=", idempotencyKey)
      .where("state", "=", "processing")
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) !== 1) {
      throw new Error("Could not complete intake idempotency record");
    }
  }
}
