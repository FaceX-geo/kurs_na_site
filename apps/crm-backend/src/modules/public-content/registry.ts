export type PublicContentOperationKey =
  | "vacancies.list"
  | "vacancies.create"
  | "vacancies.update"
  | "vacancies.publish"
  | "vacancies.archive"
  | "stories.list"
  | "stories.create"
  | "stories.update"
  | "stories.publish"
  | "stories.archive";

export interface PublicContentOperationDefinition {
  readonly key: PublicContentOperationKey;
  readonly operationId: string;
  readonly method: "GET" | "POST" | "PATCH";
  readonly path: string;
  readonly permissionCode: string;
  readonly summary: string;
}

export const PUBLIC_CONTENT_OPERATIONS = Object.freeze({
  "vacancies.list": {
    key: "vacancies.list",
    operationId: "ListAdminVacancies",
    method: "GET",
    path: "/internal/v1/admin/content/vacancies",
    permissionCode: "content.vacancy.read",
    summary: "Список вакансий для редактора лендинга",
  },
  "vacancies.create": {
    key: "vacancies.create",
    operationId: "CreateVacancy",
    method: "POST",
    path: "/internal/v1/admin/content/vacancies",
    permissionCode: "content.vacancy.manage",
    summary: "Создать черновик вакансии",
  },
  "vacancies.update": {
    key: "vacancies.update",
    operationId: "UpdateVacancy",
    method: "PATCH",
    path: "/internal/v1/admin/content/vacancies/:contentId",
    permissionCode: "content.vacancy.manage",
    summary: "Изменить вакансию",
  },
  "vacancies.publish": {
    key: "vacancies.publish",
    operationId: "PublishVacancy",
    method: "POST",
    path: "/internal/v1/admin/content/vacancies/:contentId/publish",
    permissionCode: "content.vacancy.manage",
    summary: "Опубликовать вакансию",
  },
  "vacancies.archive": {
    key: "vacancies.archive",
    operationId: "ArchiveVacancy",
    method: "POST",
    path: "/internal/v1/admin/content/vacancies/:contentId/archive",
    permissionCode: "content.vacancy.manage",
    summary: "Архивировать вакансию",
  },
  "stories.list": {
    key: "stories.list",
    operationId: "ListAdminStories",
    method: "GET",
    path: "/internal/v1/admin/content/stories",
    permissionCode: "content.story.read",
    summary: "Список историй для редактора лендинга",
  },
  "stories.create": {
    key: "stories.create",
    operationId: "CreateStory",
    method: "POST",
    path: "/internal/v1/admin/content/stories",
    permissionCode: "content.story.manage",
    summary: "Создать черновик истории",
  },
  "stories.update": {
    key: "stories.update",
    operationId: "UpdateStory",
    method: "PATCH",
    path: "/internal/v1/admin/content/stories/:contentId",
    permissionCode: "content.story.manage",
    summary: "Изменить историю",
  },
  "stories.publish": {
    key: "stories.publish",
    operationId: "PublishStory",
    method: "POST",
    path: "/internal/v1/admin/content/stories/:contentId/publish",
    permissionCode: "content.story.manage",
    summary: "Опубликовать историю",
  },
  "stories.archive": {
    key: "stories.archive",
    operationId: "ArchiveStory",
    method: "POST",
    path: "/internal/v1/admin/content/stories/:contentId/archive",
    permissionCode: "content.story.manage",
    summary: "Архивировать историю",
  },
} as const satisfies Record<PublicContentOperationKey, PublicContentOperationDefinition>);

export const PUBLIC_CONTENT_OPERATION_LIST = Object.freeze(Object.values(PUBLIC_CONTENT_OPERATIONS));

export type PublicStoryReadOperationKey = "canonical" | "legacy";

export interface PublicStoryReadOperationDefinition {
  readonly key: PublicStoryReadOperationKey;
  readonly operationId: "publicListStories" | "legacyListStories";
  readonly method: "GET";
  readonly path: "/public/v1/stories" | "/api/v1/stories";
  readonly deprecated: boolean;
  readonly summary: string;
}

export const PUBLIC_STORY_READ_OPERATIONS = Object.freeze({
  canonical: {
    key: "canonical",
    operationId: "publicListStories",
    method: "GET",
    path: "/public/v1/stories",
    deprecated: false,
    summary: "Опубликованные истории переезда",
  },
  legacy: {
    key: "legacy",
    operationId: "legacyListStories",
    method: "GET",
    path: "/api/v1/stories",
    deprecated: true,
    summary: "Опубликованные истории переезда",
  },
} as const satisfies Record<PublicStoryReadOperationKey, PublicStoryReadOperationDefinition>);

export const PUBLIC_STORY_READ_OPERATION_LIST = Object.freeze(Object.values(PUBLIC_STORY_READ_OPERATIONS));
