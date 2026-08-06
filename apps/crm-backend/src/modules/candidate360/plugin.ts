import type { FastifyInstance, FastifyRequest, FastifySchema } from "fastify";
import { AppError, ErrorEnvelopeSchema } from "../../common/errors.js";
import type { CrmActorContext } from "../crm/ports.js";
import {
  Candidate360VersionHeadersSchema,
  CandidateDocumentContentSchema,
  type CandidateDocumentListQuery,
  CandidateDocumentListQuerySchema,
  CandidateDocumentPageSchema,
  CandidateDocumentParamsSchema,
  CandidateDocumentReviewResultSchema,
  CandidateDocumentSchema,
  CandidatePersonParamsSchema,
  type CandidateRecommenderListQuery,
  CandidateRecommenderListQuerySchema,
  CandidateRecommenderPageSchema,
  type DuplicateCandidateListQuery,
  DuplicateCandidateListQuerySchema,
  DuplicateCandidatePageSchema,
  DuplicateCandidateParamsSchema,
  type LinkRecommenderBody,
  LinkRecommenderBodySchema,
  type MergeCandidateBody,
  MergeCandidateBodySchema,
  MergeCandidateResultSchema,
  RecommenderLinkSchema,
  type ReviewDocumentBody,
  ReviewDocumentBodySchema,
} from "./contracts.js";
import type { Candidate360ServicePort } from "./ports.js";
import { CANDIDATE_360_OPERATIONS, type Candidate360OperationKey } from "./registry.js";

export type Candidate360ActorResolver = (request: FastifyRequest) => Promise<CrmActorContext>;
export type Candidate360MutationRequestVerifier = (
  request: FastifyRequest,
  actor: CrmActorContext,
) => Promise<void>;

export interface Candidate360PluginOptions {
  readonly service: Candidate360ServicePort;
  readonly resolveActor: Candidate360ActorResolver;
  readonly verifyMutationRequest: Candidate360MutationRequestVerifier;
}

type RouteSchema = FastifySchema & {
  readonly operationId: string;
  readonly "x-permission-code": string;
};

const commonErrors = {
  401: { $ref: "ErrorEnvelope#" },
  403: { $ref: "ErrorEnvelope#" },
  422: { $ref: "ErrorEnvelope#" },
  500: { $ref: "ErrorEnvelope#" },
} as const;

function schemaFor(
  key: Candidate360OperationKey,
  schema: FastifySchema,
  extraErrors: Readonly<Record<number, { readonly $ref: string }>> = {},
): RouteSchema {
  const operation = CANDIDATE_360_OPERATIONS[key];
  return {
    ...schema,
    summary: operation.summary,
    operationId: operation.operationId,
    tags: ["candidate-360"],
    security: operation.method === "GET" ? [{ sessionCookie: [] }] : [{ sessionCookie: [], csrfToken: [] }],
    "x-permission-code": operation.permissionCode,
    response: { ...commonErrors, ...extraErrors, ...(schema.response ?? {}) },
  };
}

export function parseCandidate360IfMatchVersion(header: string | string[] | undefined): number {
  if (header === undefined) {
    throw new AppError(428, "precondition_required", "Передайте If-Match с текущей версией объекта");
  }
  if (Array.isArray(header)) {
    throw new AppError(422, "invalid_if_match", "If-Match должен содержать одну версию");
  }
  const match =
    /^"v([1-9][0-9]*)"$/.exec(header.trim()) ??
    /^"([1-9][0-9]*)"$/.exec(header.trim()) ??
    /^v?([1-9][0-9]*)$/.exec(header.trim());
  const version = match?.[1] ? Number(match[1]) : Number.NaN;
  if (!Number.isSafeInteger(version)) {
    throw new AppError(422, "invalid_if_match", "Некорректный формат If-Match");
  }
  return version;
}

function setVersionEtag(reply: { header(name: string, value: string): unknown }, version: number): void {
  reply.header("etag", `"v${version}"`);
}

export function candidateDocumentContentDisposition(originalName: string): string {
  const normalized = Array.from(originalName.normalize("NFC"), (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127 || character === "/" || character === "\\" ? "_" : character;
  })
    .join("")
    .trim()
    .slice(0, 180);
  const safeName = normalized || "candidate-document";
  const asciiName = safeName.replace(/[^\u0020-\u007e]/gu, "_").replace(/["\\]/gu, "_");
  const encoded = encodeURIComponent(safeName).replace(
    /[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encoded}`;
}

export async function candidate360Plugin(
  app: FastifyInstance,
  options: Candidate360PluginOptions,
): Promise<void> {
  if (!app.getSchema("ErrorEnvelope")) app.addSchema(ErrorEnvelopeSchema);

  app.get<{ Querystring: DuplicateCandidateListQuery }>(
    CANDIDATE_360_OPERATIONS["duplicates.list"].path,
    {
      schema: schemaFor("duplicates.list", {
        querystring: DuplicateCandidateListQuerySchema,
        response: { 200: DuplicateCandidatePageSchema },
      }),
    },
    async (request) => {
      const actor = await options.resolveActor(request);
      return options.service.listDuplicateCandidates(actor, request.query);
    },
  );

  app.get<{
    Params: { personId: string };
    Querystring: CandidateDocumentListQuery;
  }>(
    CANDIDATE_360_OPERATIONS["documents.list"].path,
    {
      schema: schemaFor(
        "documents.list",
        {
          params: CandidatePersonParamsSchema,
          querystring: CandidateDocumentListQuerySchema,
          response: { 200: CandidateDocumentPageSchema },
        },
        { 404: { $ref: "ErrorEnvelope#" } },
      ),
    },
    async (request) => {
      const actor = await options.resolveActor(request);
      return options.service.listCandidateDocuments(actor, request.params.personId, request.query);
    },
  );

  app.get<{
    Params: { personId: string };
    Querystring: CandidateRecommenderListQuery;
  }>(
    CANDIDATE_360_OPERATIONS["recommenders.list"].path,
    {
      schema: schemaFor(
        "recommenders.list",
        {
          params: CandidatePersonParamsSchema,
          querystring: CandidateRecommenderListQuerySchema,
          response: { 200: CandidateRecommenderPageSchema },
        },
        { 404: { $ref: "ErrorEnvelope#" } },
      ),
    },
    async (request) => {
      const actor = await options.resolveActor(request);
      return options.service.listCandidateRecommenders(actor, request.params.personId, request.query);
    },
  );

  app.get<{ Params: { documentId: string } }>(
    CANDIDATE_360_OPERATIONS["documents.get"].path,
    {
      schema: schemaFor(
        "documents.get",
        {
          params: CandidateDocumentParamsSchema,
          response: { 200: CandidateDocumentSchema },
        },
        { 404: { $ref: "ErrorEnvelope#" } },
      ),
    },
    async (request) => {
      const actor = await options.resolveActor(request);
      return options.service.getCandidateDocument(actor, request.params.documentId);
    },
  );

  app.get<{ Params: { documentId: string } }>(
    CANDIDATE_360_OPERATIONS["documents.content"].path,
    {
      schema: schemaFor(
        "documents.content",
        {
          params: CandidateDocumentParamsSchema,
          response: {
            200: {
              description: "Binary candidate document content",
              content: {
                "application/octet-stream": { schema: CandidateDocumentContentSchema },
              },
            },
          },
        },
        {
          404: { $ref: "ErrorEnvelope#" },
          413: { $ref: "ErrorEnvelope#" },
          423: { $ref: "ErrorEnvelope#" },
          503: { $ref: "ErrorEnvelope#" },
        },
      ),
    },
    async (request, reply) => {
      const actor = await options.resolveActor(request);
      const content = await options.service.getCandidateDocumentContent(actor, request.params.documentId);
      reply.header("cache-control", "private, no-store");
      reply.header("content-disposition", candidateDocumentContentDisposition(content.originalName));
      reply.header("content-length", String(content.byteSize));
      reply.header("etag", `"sha256-${content.sha256}"`);
      reply.header("x-content-type-options", "nosniff");
      reply.type(content.mediaType);
      return reply.send(Buffer.from(content.bytes));
    },
  );

  app.post<{
    Params: { duplicateId: string };
    Headers: { "if-match"?: string; "x-csrf-token": string };
    Body: MergeCandidateBody;
  }>(
    CANDIDATE_360_OPERATIONS["duplicates.merge"].path,
    {
      schema: schemaFor(
        "duplicates.merge",
        {
          params: DuplicateCandidateParamsSchema,
          headers: Candidate360VersionHeadersSchema,
          body: MergeCandidateBodySchema,
          response: { 200: MergeCandidateResultSchema },
        },
        {
          404: { $ref: "ErrorEnvelope#" },
          409: { $ref: "ErrorEnvelope#" },
          428: { $ref: "ErrorEnvelope#" },
        },
      ),
    },
    async (request, reply) => {
      const actor = await options.resolveActor(request);
      await options.verifyMutationRequest(request, actor);
      const value = await options.service.mergeCandidate(
        actor,
        request.params.duplicateId,
        parseCandidate360IfMatchVersion(request.headers["if-match"]),
        request.body,
      );
      setVersionEtag(reply, value.duplicateVersion);
      return value;
    },
  );

  app.post<{
    Params: { personId: string };
    Headers: { "if-match"?: string; "x-csrf-token": string };
    Body: LinkRecommenderBody;
  }>(
    CANDIDATE_360_OPERATIONS["recommenders.link"].path,
    {
      schema: schemaFor(
        "recommenders.link",
        {
          params: CandidatePersonParamsSchema,
          headers: Candidate360VersionHeadersSchema,
          body: LinkRecommenderBodySchema,
          response: { 201: RecommenderLinkSchema },
        },
        {
          404: { $ref: "ErrorEnvelope#" },
          409: { $ref: "ErrorEnvelope#" },
          428: { $ref: "ErrorEnvelope#" },
        },
      ),
    },
    async (request, reply) => {
      const actor = await options.resolveActor(request);
      await options.verifyMutationRequest(request, actor);
      const value = await options.service.linkRecommender(
        actor,
        request.params.personId,
        parseCandidate360IfMatchVersion(request.headers["if-match"]),
        request.body,
      );
      setVersionEtag(reply, value.candidateVersion);
      return reply.status(201).send(value);
    },
  );

  app.post<{
    Params: { documentId: string };
    Headers: { "if-match"?: string; "x-csrf-token": string };
    Body: ReviewDocumentBody;
  }>(
    CANDIDATE_360_OPERATIONS["documents.review"].path,
    {
      schema: schemaFor(
        "documents.review",
        {
          params: CandidateDocumentParamsSchema,
          headers: Candidate360VersionHeadersSchema,
          body: ReviewDocumentBodySchema,
          response: { 200: CandidateDocumentReviewResultSchema },
        },
        {
          404: { $ref: "ErrorEnvelope#" },
          409: { $ref: "ErrorEnvelope#" },
          428: { $ref: "ErrorEnvelope#" },
        },
      ),
    },
    async (request, reply) => {
      const actor = await options.resolveActor(request);
      await options.verifyMutationRequest(request, actor);
      const value = await options.service.reviewDocument(
        actor,
        request.params.documentId,
        parseCandidate360IfMatchVersion(request.headers["if-match"]),
        request.body,
      );
      setVersionEtag(reply, value.version);
      return value;
    },
  );
}
