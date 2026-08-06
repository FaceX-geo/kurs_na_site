import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { UPLOAD_STORAGE_CEILING_BYTES } from "../src/common/upload-policy.js";
import type {
  Candidate360AuthorizationPort,
  Candidate360RepositoryPort,
  CandidateDocumentContentStorePort,
} from "../src/modules/candidate360/ports.js";
import { createCandidate360Service } from "../src/modules/candidate360/service.js";
import type { CrmAccessScope, CrmActorContext } from "../src/modules/crm/ports.js";

const signingKey = "candidate-360-test-signing-key-is-long-enough";
const actor: CrmActorContext = {
  userAccountId: "10000000-0000-4000-8000-000000000001",
  employeeProfileId: "20000000-0000-4000-8000-000000000001",
  requestId: "request-1",
};
const access: CrmAccessScope = {
  visibility: "assigned",
  actorUserAccountId: actor.userAccountId,
  actorEmployeeProfileId: actor.employeeProfileId,
  employeeProfileIds: [actor.employeeProfileId ?? ""],
  teamIds: [],
  organizationUnitIds: [],
  fieldMask: [],
};

function fixture(
  repository: Partial<Candidate360RepositoryPort>,
  contentStore?: CandidateDocumentContentStorePort,
) {
  const authorize = vi.fn(async () => access);
  const authorization: Candidate360AuthorizationPort = { authorize };
  const service = createCandidate360Service({
    repository: repository as Candidate360RepositoryPort,
    authorization,
    cursorSigningKey: signingKey,
    maxDocumentContentBytes: UPLOAD_STORAGE_CEILING_BYTES,
    ...(contentStore ? { contentStore } : {}),
  });
  return { service, authorize };
}

describe("Candidate 360 service", () => {
  it("signs cursors against actor and filters", async () => {
    const listDuplicateCandidates = vi
      .fn()
      .mockResolvedValueOnce({
        items: [],
        nextCursor: {
          createdAt: "2026-08-06T10:00:00.000Z",
          id: "30000000-0000-4000-8000-000000000001",
        },
        hasMore: true,
      })
      .mockResolvedValueOnce({ items: [], nextCursor: null, hasMore: false });
    const { service } = fixture({ listDuplicateCandidates });

    const first = await service.listDuplicateCandidates(actor, { limit: 20 });
    expect(first.page.nextCursor).toEqual(expect.any(String));
    const cursor = first.page.nextCursor;
    if (!cursor) throw new Error("Expected signed cursor");

    await service.listDuplicateCandidates(actor, { limit: 20, cursor });
    expect(listDuplicateCandidates).toHaveBeenNthCalledWith(
      2,
      access,
      expect.objectContaining({
        state: "open",
        limit: 20,
        cursor: {
          createdAt: "2026-08-06T10:00:00.000Z",
          id: "30000000-0000-4000-8000-000000000001",
        },
      }),
    );

    await expect(
      service.listDuplicateCandidates(actor, { limit: 20, cursor, minimumConfidence: 0.9 }),
    ).rejects.toMatchObject({ statusCode: 422, code: "invalid_cursor" });
  });

  it("passes reviewer, reason, provenance, scope and optimistic version to merge", async () => {
    const mergeCandidate = vi.fn(async () => ({
      kind: "succeeded" as const,
      value: {
        mergeId: "40000000-0000-4000-8000-000000000001",
        duplicateCandidateId: "30000000-0000-4000-8000-000000000001",
        survivorPersonId: "50000000-0000-4000-8000-000000000001",
        mergedPersonId: "50000000-0000-4000-8000-000000000002",
        state: "active" as const,
        reversible: true as const,
        mergeVersion: 1,
        duplicateVersion: 8,
        reviewedByUserAccountId: actor.userAccountId,
        reason: "Подтверждено специалистом",
        provenance: { origin: "manual" as const },
        mergedAt: "2026-08-06T10:00:00.000Z",
      },
    }));
    const { service, authorize } = fixture({ mergeCandidate });

    await service.mergeCandidate(actor, "30000000-0000-4000-8000-000000000001", 7, {
      survivorPersonId: "50000000-0000-4000-8000-000000000001",
      reason: "  Подтверждено специалистом  ",
    });

    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: expect.objectContaining({
          operationId: "MergeCandidate",
          permissionCode: "crm.candidate.merge",
        }),
        resource: { type: "candidate_duplicate", id: "30000000-0000-4000-8000-000000000001" },
      }),
    );
    expect(mergeCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: 7,
        reason: "Подтверждено специалистом",
        provenance: { origin: "manual" },
        actor,
        access,
      }),
    );
  });

  it("surfaces the employee identity merge boundary as a deterministic conflict", async () => {
    const { service } = fixture({
      mergeCandidate: async () => ({
        kind: "employee_identity_conflict",
        personIds: ["50000000-0000-4000-8000-000000000002"],
      }),
    });

    await expect(
      service.mergeCandidate(actor, "30000000-0000-4000-8000-000000000001", 2, {
        survivorPersonId: "50000000-0000-4000-8000-000000000001",
        reason: "Обнаружен полный дубль",
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: "employee_identity_merge_forbidden" });
  });

  it("rejects a self-recommender before authorization or persistence", async () => {
    const linkRecommender = vi.fn();
    const { service, authorize } = fixture({ linkRecommender });
    const personId = "50000000-0000-4000-8000-000000000001";

    await expect(
      service.linkRecommender(actor, personId, 3, {
        recommenderPersonId: personId,
        relationshipType: "referrer",
        reason: "Рекомендация участника",
      }),
    ).rejects.toMatchObject({ statusCode: 422, code: "self_recommender_forbidden" });
    expect(authorize).not.toHaveBeenCalled();
    expect(linkRecommender).not.toHaveBeenCalled();
  });

  it("maps a stale document review to an optimistic-lock conflict", async () => {
    const { service } = fixture({
      reviewDocument: async () => ({ kind: "version_conflict", currentVersion: 9 }),
    });

    await expect(
      service.reviewDocument(actor, "60000000-0000-4000-8000-000000000001", 8, {
        decision: "approved",
        reason: "Документ проверен вручную",
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "version_conflict",
      details: { expectedVersion: 8, currentVersion: 9 },
    });
  });

  it("exposes the fail-closed review gate with a stable scan_not_clean code", async () => {
    const { service } = fixture({
      reviewDocument: async () => ({
        kind: "scan_not_clean",
        scanState: "quarantined",
        currentVersion: 8,
      }),
    });

    await expect(
      service.reviewDocument(actor, "60000000-0000-4000-8000-000000000001", 8, {
        decision: "approved",
        reason: "Документ проверен вручную",
      }),
    ).rejects.toMatchObject({
      statusCode: 423,
      code: "scan_not_clean",
      details: { currentVersion: 8, scanState: "quarantined" },
    });
  });

  it("fails closed while the intake upload is still quarantined", async () => {
    const read = vi.fn();
    const recordCandidateDocumentContentAccess = vi.fn();
    const { service } = fixture(
      {
        getCandidateDocumentContentAccess: async () => ({
          kind: "blocked",
          state: "scan_pending",
        }),
        recordCandidateDocumentContentAccess,
      },
      { read },
    );

    await expect(
      service.getCandidateDocumentContent(actor, "60000000-0000-4000-8000-000000000001"),
    ).rejects.toMatchObject({ statusCode: 423, code: "document_scan_pending" });
    expect(read).not.toHaveBeenCalled();
    expect(recordCandidateDocumentContentAccess).not.toHaveBeenCalled();
  });

  it("verifies content integrity and re-checks the database gate before returning bytes", async () => {
    const bytes = new TextEncoder().encode("candidate resume");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const read = vi.fn(async () => bytes);
    const recordCandidateDocumentContentAccess = vi.fn(async () => true);
    const documentId = "60000000-0000-4000-8000-000000000001";
    const { service } = fixture(
      {
        getCandidateDocumentContentAccess: async () => ({
          kind: "ready",
          documentId,
          storageKey: "quarantine/internal-key-never-exposed",
          originalName: "resume.pdf",
          mediaType: "application/pdf",
          byteSize: bytes.byteLength,
          sha256,
        }),
        recordCandidateDocumentContentAccess,
      },
      { read },
    );

    const result = await service.getCandidateDocumentContent(actor, documentId);

    expect(read).toHaveBeenCalledWith("quarantine/internal-key-never-exposed", UPLOAD_STORAGE_CEILING_BYTES);
    expect(recordCandidateDocumentContentAccess).toHaveBeenCalledWith(actor, access, documentId);
    expect(result).toEqual({
      documentId,
      originalName: "resume.pdf",
      mediaType: "application/pdf",
      byteSize: bytes.byteLength,
      sha256,
      bytes,
    });
    expect(result).not.toHaveProperty("storageKey");
  });

  it("does not audit or return bytes when object integrity differs from intake metadata", async () => {
    const bytes = new TextEncoder().encode("tampered");
    const recordCandidateDocumentContentAccess = vi.fn(async () => true);
    const { service } = fixture(
      {
        getCandidateDocumentContentAccess: async () => ({
          kind: "ready",
          documentId: "60000000-0000-4000-8000-000000000001",
          storageKey: "internal-key",
          originalName: "resume.pdf",
          mediaType: "application/pdf",
          byteSize: bytes.byteLength,
          sha256: "a".repeat(64),
        }),
        recordCandidateDocumentContentAccess,
      },
      { read: async () => bytes },
    );

    await expect(
      service.getCandidateDocumentContent(actor, "60000000-0000-4000-8000-000000000001"),
    ).rejects.toMatchObject({ statusCode: 503, code: "document_content_integrity_failed" });
    expect(recordCandidateDocumentContentAccess).not.toHaveBeenCalled();
  });
});
