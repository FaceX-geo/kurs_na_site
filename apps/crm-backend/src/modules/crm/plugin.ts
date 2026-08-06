import type { FastifyInstance, FastifyRequest, FastifySchema } from "fastify";
import { AppError, ErrorEnvelopeSchema } from "../../common/errors.js";
import { CRM_OPERATIONS, type CrmOperationKey } from "../../registry/operation-registry.js";
import {
  type CrmActivityListQuery,
  CrmActivityListQuerySchema,
  CrmActivityPageSchema,
  CrmCandidateSummarySchema,
  CrmCaseDetailSchema,
  type CrmCaseListQuery,
  CrmCaseListQuerySchema,
  CrmCasePageSchema,
  CrmCaseParamsSchema,
  type CrmCaseTransitionBody,
  CrmCaseTransitionBodySchema,
  CrmDictionaryListSchema,
  CrmEmployerDetailSchema,
  type CrmEmployerListQuery,
  CrmEmployerListQuerySchema,
  CrmEmployerPageSchema,
  CrmEmployerParamsSchema,
  CrmFunnelListSchema,
  CrmFunnelParamsSchema,
  CrmFunnelQuerySchema,
  CrmFunnelSchema,
  type CrmPersonListQuery,
  CrmPersonListQuerySchema,
  CrmPersonPageSchema,
  CrmPersonParamsSchema,
  CrmReferralDetailSchema,
  type CrmReferralListQuery,
  CrmReferralListQuerySchema,
  CrmReferralPageSchema,
  CrmReferralParamsSchema,
  CrmTaskDetailSchema,
  type CrmTaskListQuery,
  CrmTaskListQuerySchema,
  CrmTaskPageSchema,
  CrmTaskParamsSchema,
  type CrmTaskTransitionBody,
  CrmTaskTransitionBodySchema,
  type CrmTimelineQuery,
  CrmTimelineQuerySchema,
  CrmVersionHeadersSchema,
} from "./contracts.js";
import type { CrmActorContext, CrmServicePort } from "./ports.js";

export type CrmActorResolver = (request: FastifyRequest) => Promise<CrmActorContext>;
/** Verifies CSRF and any fresh-auth policy before a cookie-authenticated mutation. */
export type CrmMutationRequestVerifier = (request: FastifyRequest, actor: CrmActorContext) => Promise<void>;

export interface CrmPluginOptions {
  readonly service: CrmServicePort;
  readonly resolveActor: CrmActorResolver;
  readonly verifyMutationRequest: CrmMutationRequestVerifier;
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
  key: CrmOperationKey,
  schema: FastifySchema,
  extraErrors: Readonly<Record<number, { readonly $ref: string }>> = {},
): RouteSchema {
  const operation = CRM_OPERATIONS[key];
  return {
    ...schema,
    summary: operation.summary,
    operationId: operation.operationId,
    tags: ["crm"],
    security: operation.method === "GET" ? [{ sessionCookie: [] }] : [{ sessionCookie: [], csrfToken: [] }],
    "x-permission-code": operation.permissionCode,
    response: {
      ...commonErrors,
      ...extraErrors,
      ...(schema.response ?? {}),
    },
  };
}

function parseIfMatchVersion(header: string | string[] | undefined): number {
  if (header === undefined) {
    throw new AppError(
      428,
      "precondition_required",
      "Для изменения передайте If-Match с текущей версией объекта",
    );
  }
  if (Array.isArray(header)) {
    throw new AppError(422, "invalid_if_match", "If-Match должен содержать одну версию");
  }

  const value = header.trim();
  const match =
    /^"v([1-9][0-9]*)"$/.exec(value) ?? /^"([1-9][0-9]*)"$/.exec(value) ?? /^v?([1-9][0-9]*)$/.exec(value);
  if (!match?.[1]) {
    throw new AppError(422, "invalid_if_match", "Некорректный формат If-Match");
  }

  const version = Number(match[1]);
  if (!Number.isSafeInteger(version)) {
    throw new AppError(422, "invalid_if_match", "Некорректная версия объекта");
  }
  return version;
}

function setVersionEtag(reply: { header(name: string, value: string): unknown }, version: number): void {
  reply.header("etag", `"v${version}"`);
}

export async function crmPlugin(app: FastifyInstance, options: CrmPluginOptions): Promise<void> {
  if (!app.getSchema("ErrorEnvelope")) {
    app.addSchema(ErrorEnvelopeSchema);
  }

  app.get<{ Querystring: CrmCaseListQuery }>(
    CRM_OPERATIONS["cases.list"].path,
    {
      schema: schemaFor("cases.list", {
        querystring: CrmCaseListQuerySchema,
        response: { 200: CrmCasePageSchema },
      }),
    },
    async (request) => {
      const actor = await options.resolveActor(request);
      return options.service.listCases(actor, request.query);
    },
  );

  app.get<{ Params: { caseId: string } }>(
    CRM_OPERATIONS["cases.get"].path,
    {
      schema: schemaFor(
        "cases.get",
        { params: CrmCaseParamsSchema, response: { 200: CrmCaseDetailSchema } },
        { 404: { $ref: "ErrorEnvelope#" } },
      ),
    },
    async (request, reply) => {
      const actor = await options.resolveActor(request);
      const value = await options.service.getCase(actor, request.params.caseId);
      setVersionEtag(reply, value.version);
      return value;
    },
  );

  app.post<{
    Params: { caseId: string };
    Headers: { "if-match"?: string; "x-csrf-token": string };
    Body: CrmCaseTransitionBody;
  }>(
    CRM_OPERATIONS["cases.transition"].path,
    {
      schema: schemaFor(
        "cases.transition",
        {
          params: CrmCaseParamsSchema,
          headers: CrmVersionHeadersSchema,
          body: CrmCaseTransitionBodySchema,
          response: { 200: CrmCaseDetailSchema },
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
      const expectedVersion = parseIfMatchVersion(request.headers["if-match"]);
      const value = await options.service.transitionCase(
        actor,
        request.params.caseId,
        expectedVersion,
        request.body,
      );
      setVersionEtag(reply, value.version);
      return value;
    },
  );

  app.get<{ Querystring: CrmPersonListQuery }>(
    CRM_OPERATIONS["people.list"].path,
    {
      schema: schemaFor("people.list", {
        querystring: CrmPersonListQuerySchema,
        response: { 200: CrmPersonPageSchema },
      }),
    },
    async (request) => {
      const actor = await options.resolveActor(request);
      return options.service.listPeople(actor, request.query);
    },
  );

  app.get<{ Params: { personId: string } }>(
    CRM_OPERATIONS["people.summary"].path,
    {
      schema: schemaFor(
        "people.summary",
        { params: CrmPersonParamsSchema, response: { 200: CrmCandidateSummarySchema } },
        { 404: { $ref: "ErrorEnvelope#" } },
      ),
    },
    async (request) => {
      const actor = await options.resolveActor(request);
      return options.service.getCandidateSummary(actor, request.params.personId);
    },
  );

  app.get<{ Querystring: CrmEmployerListQuery }>(
    CRM_OPERATIONS["employers.list"].path,
    {
      schema: schemaFor("employers.list", {
        querystring: CrmEmployerListQuerySchema,
        response: { 200: CrmEmployerPageSchema },
      }),
    },
    async (request) => {
      const actor = await options.resolveActor(request);
      return options.service.listEmployers(actor, request.query);
    },
  );

  app.get<{ Params: { employerId: string } }>(
    CRM_OPERATIONS["employers.get"].path,
    {
      schema: schemaFor(
        "employers.get",
        { params: CrmEmployerParamsSchema, response: { 200: CrmEmployerDetailSchema } },
        { 404: { $ref: "ErrorEnvelope#" } },
      ),
    },
    async (request, reply) => {
      const actor = await options.resolveActor(request);
      const value = await options.service.getEmployer(actor, request.params.employerId);
      setVersionEtag(reply, value.version);
      return value;
    },
  );

  app.get<{ Querystring: CrmReferralListQuery }>(
    CRM_OPERATIONS["referrals.list"].path,
    {
      schema: schemaFor("referrals.list", {
        querystring: CrmReferralListQuerySchema,
        response: { 200: CrmReferralPageSchema },
      }),
    },
    async (request) => {
      const actor = await options.resolveActor(request);
      return options.service.listReferrals(actor, request.query);
    },
  );

  app.get<{ Params: { referralId: string } }>(
    CRM_OPERATIONS["referrals.get"].path,
    {
      schema: schemaFor(
        "referrals.get",
        { params: CrmReferralParamsSchema, response: { 200: CrmReferralDetailSchema } },
        { 404: { $ref: "ErrorEnvelope#" } },
      ),
    },
    async (request, reply) => {
      const actor = await options.resolveActor(request);
      const value = await options.service.getReferral(actor, request.params.referralId);
      setVersionEtag(reply, value.version);
      return value;
    },
  );

  app.get<{ Querystring: CrmTaskListQuery }>(
    CRM_OPERATIONS["tasks.list"].path,
    {
      schema: schemaFor("tasks.list", {
        querystring: CrmTaskListQuerySchema,
        response: { 200: CrmTaskPageSchema },
      }),
    },
    async (request) => {
      const actor = await options.resolveActor(request);
      return options.service.listTasks(actor, request.query);
    },
  );

  app.get<{ Params: { taskId: string } }>(
    CRM_OPERATIONS["tasks.get"].path,
    {
      schema: schemaFor(
        "tasks.get",
        { params: CrmTaskParamsSchema, response: { 200: CrmTaskDetailSchema } },
        { 404: { $ref: "ErrorEnvelope#" } },
      ),
    },
    async (request, reply) => {
      const actor = await options.resolveActor(request);
      const value = await options.service.getTask(actor, request.params.taskId);
      setVersionEtag(reply, value.version);
      return value;
    },
  );

  app.post<{
    Params: { taskId: string };
    Headers: { "if-match"?: string; "x-csrf-token": string };
    Body: CrmTaskTransitionBody;
  }>(
    CRM_OPERATIONS["tasks.transition"].path,
    {
      schema: schemaFor(
        "tasks.transition",
        {
          params: CrmTaskParamsSchema,
          headers: CrmVersionHeadersSchema,
          body: CrmTaskTransitionBodySchema,
          response: { 200: CrmTaskDetailSchema },
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
      const expectedVersion = parseIfMatchVersion(request.headers["if-match"]);
      const value = await options.service.transitionTask(
        actor,
        request.params.taskId,
        expectedVersion,
        request.body,
      );
      setVersionEtag(reply, value.version);
      return value;
    },
  );

  app.get<{ Querystring: CrmActivityListQuery }>(
    CRM_OPERATIONS["activities.list"].path,
    {
      schema: schemaFor("activities.list", {
        querystring: CrmActivityListQuerySchema,
        response: { 200: CrmActivityPageSchema },
      }),
    },
    async (request) => {
      const actor = await options.resolveActor(request);
      return options.service.listActivities(actor, request.query);
    },
  );

  app.get<{ Params: { caseId: string }; Querystring: CrmTimelineQuery }>(
    CRM_OPERATIONS["timeline.list"].path,
    {
      schema: schemaFor(
        "timeline.list",
        {
          params: CrmCaseParamsSchema,
          querystring: CrmTimelineQuerySchema,
          response: { 200: CrmActivityPageSchema },
        },
        { 404: { $ref: "ErrorEnvelope#" } },
      ),
    },
    async (request) => {
      const actor = await options.resolveActor(request);
      return options.service.listCaseTimeline(actor, request.params.caseId, request.query);
    },
  );

  app.get(
    CRM_OPERATIONS["dictionaries.list"].path,
    {
      schema: schemaFor("dictionaries.list", {
        response: { 200: CrmDictionaryListSchema },
      }),
    },
    async (request) => {
      const actor = await options.resolveActor(request);
      return options.service.listDictionaries(actor);
    },
  );

  app.get(
    CRM_OPERATIONS["funnels.list"].path,
    {
      schema: schemaFor("funnels.list", {
        response: { 200: CrmFunnelListSchema },
      }),
    },
    async (request) => {
      const actor = await options.resolveActor(request);
      return { items: await options.service.listFunnels(actor) };
    },
  );

  app.get<{ Params: { funnelCode: string }; Querystring: { version?: number } }>(
    CRM_OPERATIONS["funnels.get"].path,
    {
      schema: schemaFor(
        "funnels.get",
        {
          params: CrmFunnelParamsSchema,
          querystring: CrmFunnelQuerySchema,
          response: { 200: CrmFunnelSchema },
        },
        { 404: { $ref: "ErrorEnvelope#" } },
      ),
    },
    async (request) => {
      const actor = await options.resolveActor(request);
      return options.service.getFunnel(actor, request.params.funnelCode, request.query.version);
    },
  );
}

export const parseCrmIfMatchVersion = parseIfMatchVersion;
