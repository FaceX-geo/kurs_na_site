import { describe, expect, it } from "vitest";
import { UPLOAD_STORAGE_CEILING_BYTES } from "../src/common/upload-policy.js";
import { IntakeError } from "../src/modules/intake/errors.js";
import { createIntakeService } from "../src/modules/intake/service.js";
import {
  applicationPayload,
  applicationReceipt,
  canonicalApplicationPayload,
  FakeIntakeRepository,
  FakeIntakeStorage,
  pdfBytes,
  uploadReceipt,
} from "./intake-fixtures.js";

function makeService() {
  const repository = new FakeIntakeRepository();
  const storage = new FakeIntakeStorage();
  const service = createIntakeService({
    repository,
    storage,
    maxUploadBytes: UPLOAD_STORAGE_CEILING_BYTES,
    now: () => new Date("2026-08-06T09:00:00.000Z"),
  });
  return { repository, storage, service };
}

describe("intake service", () => {
  it("maps cursor pagination to the public page contract", async () => {
    const { repository, service } = makeService();
    const result = await service.listVacancies({ sector: "medicine", cursor: "cursor_01", limit: "25" });

    expect(repository.vacancyQueries).toEqual([{ sector: "medicine", cursor: "cursor_01", limit: 25 }]);
    expect(result.page).toEqual({ limit: 25, nextCursor: "cursor_next", hasMore: true });
  });

  it("normalizes and hashes an application before crossing the repository port", async () => {
    const { repository, service } = makeService();
    const result = await service.createApplication({
      idempotencyKey: "application-key-01",
      requestId: "req_01",
      payload: applicationPayload,
    });

    expect(result).toEqual({ value: applicationReceipt, replayed: false });
    expect(repository.applicationCommands[0]).toMatchObject({
      idempotencyKey: "application-key-01",
      requestId: "req_01",
      receivedAt: "2026-08-06T09:00:00.000Z",
      input: {
        personal: { phoneE164: "+79111112233" },
        attachments: { resumeFileId: "file_resume_01" },
      },
    });
    expect(repository.applicationCommands[0]?.requestHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("reports an idempotency replay and rejects key reuse with another request", async () => {
    const { repository, service } = makeService();
    repository.applicationResult = { state: "replayed", value: applicationReceipt };
    await expect(
      service.createApplication({
        idempotencyKey: "application-key-01",
        requestId: "req_01",
        payload: applicationPayload,
      }),
    ).resolves.toMatchObject({ replayed: true });

    repository.applicationResult = { state: "conflict" };
    await expect(
      service.createApplication({
        idempotencyKey: "application-key-01",
        requestId: "req_02",
        payload: applicationPayload,
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: "idempotency_conflict" });
  });

  it("validates a vacancy binding against the published registry before persistence", async () => {
    const { repository, service } = makeService();
    const payload = {
      ...canonicalApplicationPayload,
      application: {
        ...canonicalApplicationPayload.application,
        vacancyId: "vac_medicine_01",
        vacancySector: "safety" as const,
      },
    };

    await expect(
      service.createApplication({
        idempotencyKey: "application-vacancy-01",
        requestId: "req_vacancy",
        payload,
        requireConsentEvidence: true,
        requireUploadBinding: true,
      }),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: "validation_error",
      issues: expect.arrayContaining([
        expect.objectContaining({ field: "application.vacancySector", code: "vacancy_mismatch" }),
      ]),
    });
    expect(repository.applicationCommands).toHaveLength(0);
  });

  it("rejects a one-field consent pair before crossing the repository port", async () => {
    const { repository, service } = makeService();
    await expect(
      service.createApplication({
        idempotencyKey: "application-consent-pair-01",
        requestId: "req_consent_pair",
        payload: {
          ...applicationPayload,
          consents: {
            privacyAccepted: true,
            privacyPolicyVersion: "landing-inline-2026-08-06",
          },
        },
      }),
    ).rejects.toMatchObject({ statusCode: 422, code: "validation_error" });
    expect(repository.applicationCommands).toHaveLength(0);
  });

  it("validates upload content, sanitizes its name and sends a digest to storage", async () => {
    const { service, storage } = makeService();
    const bytes = pdfBytes();
    const result = await service.storeUpload({
      idempotencyKey: "upload-key-01",
      requestId: "req_upload",
      fileName: "C:\\fakepath\\resume.pdf",
      mediaType: "application/pdf",
      bytes,
    });

    expect(result).toEqual({ value: uploadReceipt, replayed: false });
    expect(storage.commands[0]).toMatchObject({
      fileName: "resume.pdf",
      mediaType: "application/pdf",
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(storage.commands[0]?.bytes).toBe(bytes);
  });

  it("rejects an extension/content mismatch before calling storage", async () => {
    const { service, storage } = makeService();
    await expect(
      service.storeUpload({
        idempotencyKey: "upload-key-01",
        requestId: "req_upload",
        fileName: "resume.docx",
        mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        bytes: pdfBytes(),
      }),
    ).rejects.toBeInstanceOf(IntakeError);
    expect(storage.commands).toHaveLength(0);
  });

  it("accepts an empty browser MIME only after signature and extension validation", async () => {
    const { service, storage } = makeService();
    await expect(
      service.storeUpload({
        idempotencyKey: "upload-empty-mime-01",
        requestId: "req_empty_mime",
        fileName: "resume.pdf",
        mediaType: "",
        bytes: pdfBytes(),
      }),
    ).resolves.toMatchObject({ replayed: false });
    expect(storage.commands[0]?.mediaType).toBe("application/pdf");
  });
});
