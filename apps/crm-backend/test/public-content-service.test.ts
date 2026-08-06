import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../src/modules/identity/service.js";
import type { ContentActor, PublicContentRepositoryPort } from "../src/modules/public-content/ports.js";
import { createPublicContentService } from "../src/modules/public-content/service.js";

const auth: AuthContext = {
  sessionId: "10000000-0000-4000-8000-000000000001",
  userAccountId: "10000000-0000-4000-8000-000000000002",
  personId: "10000000-0000-4000-8000-000000000003",
  email: "admin@example.test",
  authenticationLevel: "mfa",
  csrfTokenHash: "csrf-hash",
  roles: ["platform_superadmin"],
  permissions: [
    "content.vacancy.read",
    "content.vacancy.manage",
    "content.story.read",
    "content.story.manage",
  ],
  businessRole: "SUPER_ADMIN",
  employeeProfileId: null,
};

const actor: ContentActor = { auth, requestId: "request-1" };

function fixture(overrides: Partial<PublicContentRepositoryPort> = {}) {
  const repository = {
    listVacancies: vi.fn(async () => ({
      items: [],
      page: { limit: 50, hasMore: false, nextCursor: null },
    })),
    listStories: vi.fn(async () => ({
      items: [],
      page: { limit: 50, hasMore: false, nextCursor: null },
    })),
    listPublicStories: vi.fn(async () => ({
      items: [],
      suppressedIds: [],
      page: { limit: 50, hasMore: false, nextCursor: null },
    })),
    createVacancy: vi.fn(),
    updateVacancy: vi.fn(),
    setVacancyState: vi.fn(),
    createStory: vi.fn(),
    updateStory: vi.fn(),
    setStoryState: vi.fn(),
    ...overrides,
  } as unknown as PublicContentRepositoryPort;
  return { repository, service: createPublicContentService(repository) };
}

describe("public content service", () => {
  it("denies an authenticated specialist before the repository boundary", async () => {
    const { repository, service } = fixture();
    const specialist: ContentActor = {
      ...actor,
      auth: {
        ...auth,
        roles: ["crm_project_manager"],
        permissions: ["crm.case.read"],
        businessRole: "SPECIALIST",
        employeeProfileId: "20000000-0000-4000-8000-000000000001",
      },
    };

    await expect(service.listStories(specialist, {})).rejects.toMatchObject({
      statusCode: 403,
      code: "permission_denied",
    });
    expect(repository.listStories).not.toHaveBeenCalled();
  });

  it("normalizes bounded admin pagination without dropping the state filter", async () => {
    const { repository, service } = fixture();

    await service.listVacancies(actor, { cursor: "signed-cursor", limit: "100", state: "archived" });

    expect(repository.listVacancies).toHaveBeenCalledWith({
      cursor: "signed-cursor",
      limit: 100,
      state: "archived",
    });
  });

  it("keeps the public story query free of an injected publication-state filter", async () => {
    const { repository, service } = fixture();

    await service.listPublicStories({ cursor: "signed-cursor", limit: "25", state: "draft" } as never);

    expect(repository.listPublicStories).toHaveBeenCalledWith({ cursor: "signed-cursor", limit: 25 });
  });

  it("rejects a stale-client mutation without a positive safe version", () => {
    const { repository, service } = fixture();

    expect(() =>
      service.archiveStory(
        actor,
        "30000000-0000-4000-8000-000000000001",
        0,
        "archive-key-1",
        "Устаревшая версия",
      ),
    ).toThrowError(expect.objectContaining({ statusCode: 428, code: "precondition_required" }));
    expect(repository.setStoryState).not.toHaveBeenCalled();
  });
});
