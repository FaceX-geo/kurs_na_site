import { AppError } from "../../common/errors.js";
import { boundedLimit } from "../../common/pagination.js";
import type {
  AdminStory,
  AdminVacancy,
  ContentListQuery,
  PublicContentListQuery,
  StoryContentInput,
  VacancyContentInput,
} from "./contracts.js";
import type { ContentActor, ContentMutationResult, PublicContentRepositoryPort } from "./ports.js";

function requirePermission(actor: ContentActor, permission: string): void {
  if (!actor.auth.permissions.includes(permission)) {
    throw new AppError(403, "permission_denied", "Недостаточно прав для управления контентом");
  }
}

function normalizedQuery(query: ContentListQuery): ContentListQuery {
  const normalized: ContentListQuery = {
    limit: boundedLimit(typeof query.limit === "string" ? Number(query.limit) : query.limit, 50, 100),
  };
  if (query.cursor !== undefined) normalized.cursor = query.cursor;
  if (query.state !== undefined) normalized.state = query.state;
  return normalized;
}

export interface PublicContentService {
  listVacancies(
    actor: ContentActor,
    query: ContentListQuery,
  ): Promise<Awaited<ReturnType<PublicContentRepositoryPort["listVacancies"]>>>;
  listStories(
    actor: ContentActor,
    query: ContentListQuery,
  ): Promise<Awaited<ReturnType<PublicContentRepositoryPort["listStories"]>>>;
  listPublicStories(
    query: PublicContentListQuery,
  ): Promise<Awaited<ReturnType<PublicContentRepositoryPort["listPublicStories"]>>>;
  createVacancy(
    actor: ContentActor,
    idempotencyKey: string,
    input: VacancyContentInput,
  ): Promise<ContentMutationResult<AdminVacancy>>;
  updateVacancy(
    actor: ContentActor,
    contentId: string,
    expectedVersion: number,
    idempotencyKey: string,
    input: VacancyContentInput,
  ): Promise<ContentMutationResult<AdminVacancy>>;
  publishVacancy(
    actor: ContentActor,
    contentId: string,
    expectedVersion: number,
    idempotencyKey: string,
    reason: string,
  ): Promise<ContentMutationResult<AdminVacancy>>;
  archiveVacancy(
    actor: ContentActor,
    contentId: string,
    expectedVersion: number,
    idempotencyKey: string,
    reason: string,
  ): Promise<ContentMutationResult<AdminVacancy>>;
  createStory(
    actor: ContentActor,
    idempotencyKey: string,
    input: StoryContentInput,
  ): Promise<ContentMutationResult<AdminStory>>;
  updateStory(
    actor: ContentActor,
    contentId: string,
    expectedVersion: number,
    idempotencyKey: string,
    input: StoryContentInput,
  ): Promise<ContentMutationResult<AdminStory>>;
  publishStory(
    actor: ContentActor,
    contentId: string,
    expectedVersion: number,
    idempotencyKey: string,
    reason: string,
  ): Promise<ContentMutationResult<AdminStory>>;
  archiveStory(
    actor: ContentActor,
    contentId: string,
    expectedVersion: number,
    idempotencyKey: string,
    reason: string,
  ): Promise<ContentMutationResult<AdminStory>>;
}

function assertVersion(version: number): void {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new AppError(428, "precondition_required", "Передайте актуальный If-Match");
  }
}

export function createPublicContentService(repository: PublicContentRepositoryPort): PublicContentService {
  return {
    async listVacancies(actor, query) {
      requirePermission(actor, "content.vacancy.read");
      return repository.listVacancies(normalizedQuery(query));
    },
    async listStories(actor, query) {
      requirePermission(actor, "content.story.read");
      return repository.listStories(normalizedQuery(query));
    },
    listPublicStories(query) {
      return repository.listPublicStories({
        limit: boundedLimit(typeof query.limit === "string" ? Number(query.limit) : query.limit, 50, 100),
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      });
    },
    createVacancy(actor, idempotencyKey, input) {
      requirePermission(actor, "content.vacancy.manage");
      return repository.createVacancy({ actor, idempotencyKey }, input);
    },
    updateVacancy(actor, contentId, expectedVersion, idempotencyKey, input) {
      requirePermission(actor, "content.vacancy.manage");
      assertVersion(expectedVersion);
      return repository.updateVacancy({ actor, idempotencyKey, expectedVersion }, contentId, input);
    },
    publishVacancy(actor, contentId, expectedVersion, idempotencyKey, reason) {
      requirePermission(actor, "content.vacancy.manage");
      assertVersion(expectedVersion);
      return repository.setVacancyState(
        { actor, idempotencyKey, expectedVersion },
        contentId,
        "published",
        reason,
      );
    },
    archiveVacancy(actor, contentId, expectedVersion, idempotencyKey, reason) {
      requirePermission(actor, "content.vacancy.manage");
      assertVersion(expectedVersion);
      return repository.setVacancyState(
        { actor, idempotencyKey, expectedVersion },
        contentId,
        "archived",
        reason,
      );
    },
    createStory(actor, idempotencyKey, input) {
      requirePermission(actor, "content.story.manage");
      return repository.createStory({ actor, idempotencyKey }, input);
    },
    updateStory(actor, contentId, expectedVersion, idempotencyKey, input) {
      requirePermission(actor, "content.story.manage");
      assertVersion(expectedVersion);
      return repository.updateStory({ actor, idempotencyKey, expectedVersion }, contentId, input);
    },
    publishStory(actor, contentId, expectedVersion, idempotencyKey, reason) {
      requirePermission(actor, "content.story.manage");
      assertVersion(expectedVersion);
      return repository.setStoryState(
        { actor, idempotencyKey, expectedVersion },
        contentId,
        "published",
        reason,
      );
    },
    archiveStory(actor, contentId, expectedVersion, idempotencyKey, reason) {
      requirePermission(actor, "content.story.manage");
      assertVersion(expectedVersion);
      return repository.setStoryState(
        { actor, idempotencyKey, expectedVersion },
        contentId,
        "archived",
        reason,
      );
    },
  };
}
