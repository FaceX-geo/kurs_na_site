import type { Page } from "../../common/pagination.js";
import type { AuthContext } from "../identity/service.js";
import type {
  AdminStory,
  AdminVacancy,
  ContentListQuery,
  ContentState,
  PublicContentListQuery,
  PublicStoryPage,
  StoryContentInput,
  VacancyContentInput,
} from "./contracts.js";

export type ContentKind = "vacancy" | "story";

export interface ContentActor {
  readonly auth: AuthContext;
  readonly requestId: string;
}

export interface ContentMutationContext {
  readonly actor: ContentActor;
  readonly idempotencyKey: string;
  readonly expectedVersion?: number;
}

export interface ContentMutationResult<T> {
  readonly value: T;
  readonly replayed: boolean;
}

export interface PublicContentRepositoryPort {
  listVacancies(query: ContentListQuery): Promise<Page<AdminVacancy>>;
  listStories(query: ContentListQuery): Promise<Page<AdminStory>>;
  listPublicStories(query: PublicContentListQuery): Promise<PublicStoryPage>;
  createVacancy(
    context: ContentMutationContext,
    input: VacancyContentInput,
  ): Promise<ContentMutationResult<AdminVacancy>>;
  updateVacancy(
    context: ContentMutationContext,
    contentId: string,
    input: VacancyContentInput,
  ): Promise<ContentMutationResult<AdminVacancy>>;
  setVacancyState(
    context: ContentMutationContext,
    contentId: string,
    state: ContentState,
    reason: string,
  ): Promise<ContentMutationResult<AdminVacancy>>;
  createStory(
    context: ContentMutationContext,
    input: StoryContentInput,
  ): Promise<ContentMutationResult<AdminStory>>;
  updateStory(
    context: ContentMutationContext,
    contentId: string,
    input: StoryContentInput,
  ): Promise<ContentMutationResult<AdminStory>>;
  setStoryState(
    context: ContentMutationContext,
    contentId: string,
    state: ContentState,
    reason: string,
  ): Promise<ContentMutationResult<AdminStory>>;
}
