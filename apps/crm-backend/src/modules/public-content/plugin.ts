import type { Static, TSchema } from "@sinclair/typebox";
import type { FastifyInstance, FastifyRequest, FastifySchema } from "fastify";
import { AppError, ErrorEnvelopeSchema } from "../../common/errors.js";
import type { AuthContext } from "../identity/service.js";
import {
  AdminStoryPageSchema,
  AdminStorySchema,
  AdminVacancyPageSchema,
  AdminVacancySchema,
  ContentCreateHeadersSchema,
  ContentListQuerySchema,
  ContentMutationHeadersSchema,
  ContentParamsSchema,
  ContentStateChangeBodySchema,
  PublicContentListQuerySchema,
  PublicStoryPageSchema,
  StoryContentInputSchema,
  VacancyContentInputSchema,
} from "./contracts.js";
import type { ContentActor } from "./ports.js";
import {
  PUBLIC_CONTENT_OPERATIONS,
  PUBLIC_STORY_READ_OPERATION_LIST,
  type PublicContentOperationKey,
} from "./registry.js";
import type { PublicContentService } from "./service.js";

export interface PublicContentPluginOptions {
  readonly service: PublicContentService;
  readonly resolveAuth: (request: FastifyRequest) => Promise<AuthContext>;
  readonly verifyMutationRequest: (request: FastifyRequest, auth: AuthContext) => Promise<void>;
}

const errors = {
  401: { $ref: "ErrorEnvelope#" },
  403: { $ref: "ErrorEnvelope#" },
  404: { $ref: "ErrorEnvelope#" },
  409: { $ref: "ErrorEnvelope#" },
  422: { $ref: "ErrorEnvelope#" },
  428: { $ref: "ErrorEnvelope#" },
  500: { $ref: "ErrorEnvelope#" },
} as const;

function schemaFor(
  key: PublicContentOperationKey,
  schema: FastifySchema,
): FastifySchema & { operationId: string; "x-permission-code": string } {
  const operation = PUBLIC_CONTENT_OPERATIONS[key];
  return {
    ...schema,
    operationId: operation.operationId,
    summary: operation.summary,
    tags: ["public-content"],
    security: operation.method === "GET" ? [{ sessionCookie: [] }] : [{ sessionCookie: [], csrfToken: [] }],
    "x-permission-code": operation.permissionCode,
    response: { ...errors, ...(schema.response ?? {}) },
  };
}

export function parsePublicContentIfMatchVersion(value: string | string[] | undefined): number {
  if (value === undefined) {
    throw new AppError(428, "precondition_required", "Передайте If-Match с текущей версией материала");
  }
  if (Array.isArray(value)) {
    throw new AppError(422, "invalid_if_match", "If-Match должен содержать одну версию");
  }
  const normalized = value.trim();
  const match =
    /^"v([1-9][0-9]*)"$/u.exec(normalized) ??
    /^"([1-9][0-9]*)"$/u.exec(normalized) ??
    /^v?([1-9][0-9]*)$/u.exec(normalized);
  const version = match?.[1] ? Number(match[1]) : Number.NaN;
  if (!Number.isSafeInteger(version)) {
    throw new AppError(422, "invalid_if_match", "Некорректный формат If-Match");
  }
  return version;
}

const mutationResponseHeaders = {
  ETag: {
    type: "string",
    pattern: '^"v[1-9][0-9]*"$',
    description: "Версия материала для следующего If-Match",
  },
  "Idempotency-Replayed": {
    type: "string",
    enum: ["true"],
    description: "Присутствует только для точного replay завершённой операции",
  },
} as const;

function mutationResponse(schema: TSchema): TSchema & { readonly headers: typeof mutationResponseHeaders } {
  return { ...schema, headers: mutationResponseHeaders };
}

function responseHeaders(
  reply: { header(name: string, value: string): unknown },
  version: number,
  replayed: boolean,
): void {
  reply.header("etag", `"v${version}"`);
  if (replayed) reply.header("idempotency-replayed", "true");
}

async function actor(
  options: PublicContentPluginOptions,
  request: FastifyRequest,
  mutation: boolean,
): Promise<ContentActor> {
  const auth = await options.resolveAuth(request);
  if (mutation) await options.verifyMutationRequest(request, auth);
  return { auth, requestId: request.id };
}

type ListQuery = Static<typeof ContentListQuerySchema>;
type PublicListQuery = Static<typeof PublicContentListQuerySchema>;
type Params = Static<typeof ContentParamsSchema>;
type CreateHeaders = Static<typeof ContentCreateHeadersSchema>;
type MutationHeaders = Static<typeof ContentMutationHeadersSchema>;
type StateBody = Static<typeof ContentStateChangeBodySchema>;

export async function publicContentPlugin(
  app: FastifyInstance,
  options: PublicContentPluginOptions,
): Promise<void> {
  if (!app.getSchema("ErrorEnvelope")) app.addSchema(ErrorEnvelopeSchema);

  const registerAdmin = <B extends TSchema, R extends { version: number }>(input: {
    readonly kind: "vacancies" | "stories";
    readonly listKey: PublicContentOperationKey;
    readonly createKey: PublicContentOperationKey;
    readonly updateKey: PublicContentOperationKey;
    readonly publishKey: PublicContentOperationKey;
    readonly archiveKey: PublicContentOperationKey;
    readonly bodySchema: B;
    readonly itemSchema: TSchema;
    readonly pageSchema: TSchema;
    readonly list: (actor: ContentActor, query: ListQuery) => Promise<unknown>;
    readonly create: (
      actor: ContentActor,
      key: string,
      body: Static<B>,
    ) => Promise<{ value: R; replayed: boolean }>;
    readonly update: (
      actor: ContentActor,
      id: string,
      version: number,
      key: string,
      body: Static<B>,
    ) => Promise<{ value: R; replayed: boolean }>;
    readonly publish: (
      actor: ContentActor,
      id: string,
      version: number,
      key: string,
      reason: string,
    ) => Promise<{ value: R; replayed: boolean }>;
    readonly archive: (
      actor: ContentActor,
      id: string,
      version: number,
      key: string,
      reason: string,
    ) => Promise<{ value: R; replayed: boolean }>;
  }) => {
    const base = `/internal/v1/admin/content/${input.kind}`;
    app.get<{ Querystring: ListQuery }>(
      base,
      {
        schema: schemaFor(input.listKey, {
          querystring: ContentListQuerySchema,
          response: { 200: input.pageSchema },
        }),
      },
      async (request) => input.list(await actor(options, request, false), request.query),
    );

    app.post<{ Headers: CreateHeaders; Body: Static<B> }>(
      base,
      {
        schema: schemaFor(input.createKey, {
          headers: ContentCreateHeadersSchema,
          body: input.bodySchema,
          response: {
            200: mutationResponse(input.itemSchema),
            201: mutationResponse(input.itemSchema),
          },
        }),
      },
      async (request, reply) => {
        const result = await input.create(
          await actor(options, request, true),
          request.headers["idempotency-key"],
          request.body,
        );
        responseHeaders(reply, result.value.version, result.replayed);
        return reply.status(result.replayed ? 200 : 201).send(result.value);
      },
    );

    app.patch<{ Params: Params; Headers: MutationHeaders; Body: Static<B> }>(
      `${base}/:contentId`,
      {
        schema: schemaFor(input.updateKey, {
          params: ContentParamsSchema,
          headers: ContentMutationHeadersSchema,
          body: input.bodySchema,
          response: { 200: mutationResponse(input.itemSchema) },
        }),
      },
      async (request, reply) => {
        const result = await input.update(
          await actor(options, request, true),
          request.params.contentId,
          parsePublicContentIfMatchVersion(request.headers["if-match"]),
          request.headers["idempotency-key"],
          request.body,
        );
        responseHeaders(reply, result.value.version, result.replayed);
        return result.value;
      },
    );

    const registerState = (
      suffix: "publish" | "archive",
      key: PublicContentOperationKey,
      execute: typeof input.publish,
    ) =>
      app.post<{ Params: Params; Headers: MutationHeaders; Body: StateBody }>(
        `${base}/:contentId/${suffix}`,
        {
          schema: schemaFor(key, {
            params: ContentParamsSchema,
            headers: ContentMutationHeadersSchema,
            body: ContentStateChangeBodySchema,
            response: { 200: mutationResponse(input.itemSchema) },
          }),
        },
        async (request, reply) => {
          const result = await execute(
            await actor(options, request, true),
            request.params.contentId,
            parsePublicContentIfMatchVersion(request.headers["if-match"]),
            request.headers["idempotency-key"],
            request.body.reason,
          );
          responseHeaders(reply, result.value.version, result.replayed);
          return result.value;
        },
      );

    registerState("publish", input.publishKey, input.publish);
    registerState("archive", input.archiveKey, input.archive);
  };

  registerAdmin({
    kind: "vacancies",
    listKey: "vacancies.list",
    createKey: "vacancies.create",
    updateKey: "vacancies.update",
    publishKey: "vacancies.publish",
    archiveKey: "vacancies.archive",
    bodySchema: VacancyContentInputSchema,
    itemSchema: AdminVacancySchema,
    pageSchema: AdminVacancyPageSchema,
    list: (contentActor, query) => options.service.listVacancies(contentActor, query),
    create: (contentActor, key, body) => options.service.createVacancy(contentActor, key, body),
    update: (contentActor, id, version, key, body) =>
      options.service.updateVacancy(contentActor, id, version, key, body),
    publish: (contentActor, id, version, key, reason) =>
      options.service.publishVacancy(contentActor, id, version, key, reason),
    archive: (contentActor, id, version, key, reason) =>
      options.service.archiveVacancy(contentActor, id, version, key, reason),
  });

  registerAdmin({
    kind: "stories",
    listKey: "stories.list",
    createKey: "stories.create",
    updateKey: "stories.update",
    publishKey: "stories.publish",
    archiveKey: "stories.archive",
    bodySchema: StoryContentInputSchema,
    itemSchema: AdminStorySchema,
    pageSchema: AdminStoryPageSchema,
    list: (contentActor, query) => options.service.listStories(contentActor, query),
    create: (contentActor, key, body) => options.service.createStory(contentActor, key, body),
    update: (contentActor, id, version, key, body) =>
      options.service.updateStory(contentActor, id, version, key, body),
    publish: (contentActor, id, version, key, reason) =>
      options.service.publishStory(contentActor, id, version, key, reason),
    archive: (contentActor, id, version, key, reason) =>
      options.service.archiveStory(contentActor, id, version, key, reason),
  });

  for (const operation of PUBLIC_STORY_READ_OPERATION_LIST) {
    app.get<{ Querystring: PublicListQuery }>(
      operation.path,
      {
        schema: {
          tags: ["public-content"],
          operationId: operation.operationId,
          summary: operation.summary,
          security: [],
          deprecated: operation.deprecated,
          querystring: PublicContentListQuerySchema,
          response: { 200: PublicStoryPageSchema, ...errors },
        },
      },
      async (request) => options.service.listPublicStories(request.query),
    );
  }
}
