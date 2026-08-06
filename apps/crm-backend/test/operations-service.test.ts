import { describe, expect, it, vi } from "vitest";
import { AppError } from "../src/common/errors.js";
import type { AuditEvent, MigrationConflict, MigrationRun } from "../src/modules/operations/contracts.js";
import type {
  OperationsAccessScope,
  OperationsActorContext,
  OperationsAuthorizationPort,
  OperationsReadRepositoryPort,
} from "../src/modules/operations/ports.js";
import { createOperationsReadService } from "../src/modules/operations/service.js";

const cursorKey = "operations-test-cursor-signing-key-32-characters";
const actor: OperationsActorContext = {
  userAccountId: "11111111-1111-4111-8111-111111111111",
  requestId: "request-1",
};
const allScope: OperationsAccessScope = {
  visibility: "all",
  actorUserAccountId: actor.userAccountId,
  resourceIds: [],
  includeActorEvents: true,
};

const migrationRun: MigrationRun = {
  publicId: "migration_test",
  sourceSystem: "bitrix",
  snapshotSha256: "a".repeat(64),
  manifestVersion: "v1",
  transformVersion: "v1",
  state: "dry_running",
  mode: "dry-run",
  startedAt: "2026-08-06T10:00:00.000Z",
  finishedAt: null,
  expectedRows: 10,
  processedRows: 5,
  alreadyAppliedRows: 0,
  outcomeCounts: {
    migrated: 0,
    linkedExisting: 0,
    excludedWithReason: 2,
    conflictRecorded: 3,
    quarantined: 0,
  },
  blockerCodes: ["IMPORT_PREFLIGHT_BLOCKED"],
};

const conflict: MigrationConflict = {
  id: "22222222-2222-4222-8222-222222222222",
  runId: "migration_test",
  conflictType: "missing_relation",
  sourceTable: "b_crm_deal",
  sourceKeyDigest: "b".repeat(64),
  severity: "blocking",
  state: "open",
  reasonCode: "PERSON_LINK_NOT_PROVEN",
  resolutionPresent: false,
  version: 1,
  createdAt: "2026-08-06T10:01:00.000Z",
  updatedAt: "2026-08-06T10:01:00.000Z",
  resolvedAt: null,
};

const auditEvent: AuditEvent = {
  id: "33333333-3333-4333-8333-333333333333",
  eventType: "migration.run.started",
  occurredAt: "2026-08-06T10:02:00.000Z",
  actorType: "user_account",
  actorInOwnScope: true,
  subjectType: "migration_run",
  subjectPresent: true,
  requestId: "request-1",
  reasonCode: "DRY_RUN_REQUESTED",
  policyVersion: "audit-v1",
  hasBeforeState: false,
  hasAfterState: true,
  eventHash: "c".repeat(64),
  previousHashPresent: true,
};

function createDependencies(scope: OperationsAccessScope = allScope) {
  const authorization: OperationsAuthorizationPort = {
    authorize: vi.fn(async () => scope),
  };
  const repository: OperationsReadRepositoryPort = {
    listMigrationRuns: vi.fn(async () => ({
      items: [migrationRun],
      hasMore: true,
      nextCursor: {
        createdAt: migrationRun.startedAt,
        id: "44444444-4444-4444-8444-444444444444",
      },
    })),
    getMigrationRun: vi.fn(async () => migrationRun),
    listMigrationConflicts: vi.fn(async () => ({ items: [conflict], hasMore: false, nextCursor: null })),
    getMigrationConflict: vi.fn(async () => conflict),
    listAuditEvents: vi.fn(async () => ({ items: [auditEvent], hasMore: false, nextCursor: null })),
    readMetrics: vi.fn(async () => ({
      migrationRuns: { dryRunning: 1, failed: 0, completed: 0 },
      migrationConflicts: { openBlocking: 1, openWarning: 0 },
      outbox: { pending: 2, retrying: 1 },
      auditEvents: 10,
    })),
  };
  return { authorization, repository };
}

describe("operations read service", () => {
  it("authorizes before listing and emits a signed opaque cursor", async () => {
    const dependencies = createDependencies();
    const service = createOperationsReadService({ ...dependencies, cursorSigningKey: cursorKey });
    const first = await service.listMigrationRuns(actor, { limit: 25 });

    expect(dependencies.authorization.authorize).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ permissionCode: "migration.run.read" }),
    );
    expect(first.page.nextCursor).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const nextCursor = first.page.nextCursor;
    if (!nextCursor) {
      throw new Error("Expected a next cursor");
    }

    await service.listMigrationRuns(actor, { limit: 25, cursor: nextCursor });
    expect(dependencies.repository.listMigrationRuns).toHaveBeenLastCalledWith(
      allScope,
      expect.objectContaining({
        cursor: {
          createdAt: migrationRun.startedAt,
          id: "44444444-4444-4444-8444-444444444444",
        },
      }),
    );
  });

  it("does not reach the repository when permission resolution denies", async () => {
    const dependencies = createDependencies();
    dependencies.authorization.authorize = vi.fn(async () => {
      throw new AppError(403, "permission_denied", "denied");
    });
    const service = createOperationsReadService({ ...dependencies, cursorSigningKey: cursorKey });

    await expect(service.getMigrationRun(actor, "migration_test")).rejects.toMatchObject({
      statusCode: 403,
      code: "permission_denied",
    });
    expect(dependencies.repository.getMigrationRun).not.toHaveBeenCalled();
  });

  it("keeps migration conflicts and audit in read-only repository methods", async () => {
    const dependencies = createDependencies();
    const service = createOperationsReadService({ ...dependencies, cursorSigningKey: cursorKey });

    await expect(service.getMigrationConflict(actor, conflict.id)).resolves.toEqual(conflict);
    await expect(service.listAuditEvents(actor, {})).resolves.toMatchObject({ items: [auditEvent] });
    expect(dependencies.authorization.authorize).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ permissionCode: "migration.conflict.read", method: "GET" }),
    );
    expect(dependencies.authorization.authorize).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ permissionCode: "audit.events.read", method: "GET" }),
    );
  });

  it("fails closed for metrics when a narrow scope is returned", async () => {
    const dependencies = createDependencies({
      visibility: "self",
      actorUserAccountId: actor.userAccountId,
      resourceIds: [],
      includeActorEvents: true,
    });
    const service = createOperationsReadService({ ...dependencies, cursorSigningKey: cursorKey });

    await expect(service.readMetrics(actor)).rejects.toMatchObject({ statusCode: 403 });
    expect(dependencies.repository.readMetrics).not.toHaveBeenCalled();
  });
});
