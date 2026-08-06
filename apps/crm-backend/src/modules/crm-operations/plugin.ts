import type { Static } from "@sinclair/typebox";
import type { FastifyInstance, FastifyRequest, FastifySchema } from "fastify";
import { AppError, ErrorEnvelopeSchema } from "../../common/errors.js";
import type { CrmActorContext } from "../crm/ports.js";
import {
  CommunicationDraftParamsSchema,
  CommunicationDraftSchema,
  ConfirmCommunicationDraftBodySchema,
  type CreateCommunicationDraftBody,
  CreateCommunicationDraftBodySchema,
  CrmOperationsCreateHeadersSchema,
  CrmOperationsIdempotentVersionHeadersSchema,
  CrmOperationsVersionHeadersSchema,
  type DashboardSummaryQuery,
  DashboardSummaryQuerySchema,
  DashboardSummarySchema,
  type NotificationListQuery,
  NotificationListQuerySchema,
  NotificationPageSchema,
  NotificationParamsSchema,
  NotificationSchema,
  QueueCommunicationBodySchema,
  ReportExportSchema,
  type ReportRunListQuery,
  ReportRunListQuerySchema,
  ReportRunPageSchema,
  ReportRunParamsSchema,
  ReportRunSchema,
  type RunReportBody,
  RunReportBodySchema,
  SettingParamsSchema,
  SettingVersionSchema,
  type UpdateCommunicationDraftBody,
  UpdateCommunicationDraftBodySchema,
  type UpdateSettingBody,
  UpdateSettingBodySchema,
} from "./contracts.js";
import type { CrmOperationsServicePort } from "./ports.js";
import {
  CRM_OPERATIONS_OPERATIONS,
  type CrmOperationsOperationKey,
  type CrmSettingCode,
} from "./registry.js";

export interface CrmOperationsPluginOptions {
  readonly service: CrmOperationsServicePort;
  readonly resolveActor: (request: FastifyRequest) => Promise<CrmActorContext>;
  readonly verifyMutationRequest: (request: FastifyRequest, actor: CrmActorContext) => Promise<void>;
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

const QueueCommunicationResponseSchema = {
  ...CommunicationDraftSchema,
  headers: {
    ETag: {
      type: "string",
      pattern: '^"v[1-9][0-9]*"$',
      description: "Версия queued-коммуникации для следующего If-Match",
    },
    "Idempotency-Replayed": {
      type: "string",
      enum: ["true"],
      description: "Присутствует только для точного replay завершённой операции",
    },
  },
} as const;

function schemaFor(
  key: CrmOperationsOperationKey,
  schema: FastifySchema,
  extraErrors: Readonly<Record<number, { readonly $ref: string }>> = {},
): RouteSchema {
  const operation = CRM_OPERATIONS_OPERATIONS[key];
  return {
    ...schema,
    summary: operation.summary,
    operationId: operation.operationId,
    tags: ["crm-operations"],
    security: operation.method === "GET" ? [{ sessionCookie: [] }] : [{ sessionCookie: [], csrfToken: [] }],
    "x-permission-code": operation.permissionCode,
    response: { ...commonErrors, ...extraErrors, ...(schema.response ?? {}) },
  };
}

export function parseCrmOperationsIfMatchVersion(
  header: string | string[] | undefined,
  allowZero = false,
): number {
  if (header === undefined) {
    throw new AppError(428, "precondition_required", "Передайте If-Match с текущей версией объекта");
  }
  if (Array.isArray(header)) {
    throw new AppError(422, "invalid_if_match", "If-Match должен содержать одну версию");
  }
  const digits = allowZero ? "(0|[1-9][0-9]*)" : "([1-9][0-9]*)";
  const value = header.trim();
  const match =
    new RegExp(`^"v${digits}"$`).exec(value) ??
    new RegExp(`^"${digits}"$`).exec(value) ??
    new RegExp(`^v?${digits}$`).exec(value);
  const version = match?.[1] === undefined ? Number.NaN : Number(match[1]);
  if (!Number.isSafeInteger(version)) {
    throw new AppError(422, "invalid_if_match", "Некорректный формат If-Match");
  }
  return version;
}

function setVersionEtag(reply: { header(name: string, value: string): unknown }, version: number): void {
  reply.header("etag", `"v${version}"`);
}

function setIdempotencyReplay(
  reply: { header(name: string, value: string): unknown },
  replayed: boolean,
): void {
  if (replayed) reply.header("idempotency-replayed", "true");
}

async function actorAndVerify(
  options: CrmOperationsPluginOptions,
  request: FastifyRequest,
): Promise<CrmActorContext> {
  const actor = await options.resolveActor(request);
  await options.verifyMutationRequest(request, actor);
  return actor;
}

type CreateHeaders = Static<typeof CrmOperationsCreateHeadersSchema>;
type VersionHeaders = Static<typeof CrmOperationsVersionHeadersSchema>;
type IdempotentVersionHeaders = Static<typeof CrmOperationsIdempotentVersionHeadersSchema>;

export async function crmOperationsPlugin(
  app: FastifyInstance,
  options: CrmOperationsPluginOptions,
): Promise<void> {
  if (!app.getSchema("ErrorEnvelope")) app.addSchema(ErrorEnvelopeSchema);

  app.post<{ Headers: CreateHeaders; Body: CreateCommunicationDraftBody }>(
    CRM_OPERATIONS_OPERATIONS["communications.create"].path,
    {
      schema: schemaFor("communications.create", {
        headers: CrmOperationsCreateHeadersSchema,
        body: CreateCommunicationDraftBodySchema,
        response: { 200: CommunicationDraftSchema, 201: CommunicationDraftSchema },
      }),
    },
    async (request, reply) => {
      const actor = await actorAndVerify(options, request);
      const result = await options.service.createCommunicationDraft(
        actor,
        request.headers["idempotency-key"],
        request.body,
      );
      setVersionEtag(reply, result.value.version);
      setIdempotencyReplay(reply, result.replayed);
      return reply.status(result.replayed ? 200 : 201).send(result.value);
    },
  );

  app.patch<{
    Params: { draftId: string };
    Headers: VersionHeaders;
    Body: UpdateCommunicationDraftBody;
  }>(
    CRM_OPERATIONS_OPERATIONS["communications.update"].path,
    {
      schema: schemaFor(
        "communications.update",
        {
          params: CommunicationDraftParamsSchema,
          headers: CrmOperationsVersionHeadersSchema,
          body: UpdateCommunicationDraftBodySchema,
          response: { 200: CommunicationDraftSchema },
        },
        {
          404: { $ref: "ErrorEnvelope#" },
          409: { $ref: "ErrorEnvelope#" },
          428: { $ref: "ErrorEnvelope#" },
        },
      ),
    },
    async (request, reply) => {
      const actor = await actorAndVerify(options, request);
      const value = await options.service.updateCommunicationDraft(
        actor,
        request.params.draftId,
        parseCrmOperationsIfMatchVersion(request.headers["if-match"]),
        request.body,
      );
      setVersionEtag(reply, value.version);
      return value;
    },
  );

  app.post<{
    Params: { draftId: string };
    Headers: VersionHeaders;
    Body: Static<typeof ConfirmCommunicationDraftBodySchema>;
  }>(
    CRM_OPERATIONS_OPERATIONS["communications.confirm"].path,
    {
      schema: schemaFor(
        "communications.confirm",
        {
          params: CommunicationDraftParamsSchema,
          headers: CrmOperationsVersionHeadersSchema,
          body: ConfirmCommunicationDraftBodySchema,
          response: { 200: CommunicationDraftSchema },
        },
        {
          404: { $ref: "ErrorEnvelope#" },
          409: { $ref: "ErrorEnvelope#" },
          428: { $ref: "ErrorEnvelope#" },
        },
      ),
    },
    async (request, reply) => {
      const actor = await actorAndVerify(options, request);
      const value = await options.service.confirmCommunicationDraft(
        actor,
        request.params.draftId,
        parseCrmOperationsIfMatchVersion(request.headers["if-match"]),
        request.body,
      );
      setVersionEtag(reply, value.version);
      return value;
    },
  );

  app.post<{
    Params: { draftId: string };
    Headers: IdempotentVersionHeaders;
    Body: Static<typeof QueueCommunicationBodySchema>;
  }>(
    CRM_OPERATIONS_OPERATIONS["communications.queue"].path,
    {
      schema: schemaFor(
        "communications.queue",
        {
          params: CommunicationDraftParamsSchema,
          headers: CrmOperationsIdempotentVersionHeadersSchema,
          body: QueueCommunicationBodySchema,
          response: { 200: QueueCommunicationResponseSchema },
        },
        {
          404: { $ref: "ErrorEnvelope#" },
          409: { $ref: "ErrorEnvelope#" },
          428: { $ref: "ErrorEnvelope#" },
        },
      ),
    },
    async (request, reply) => {
      const actor = await actorAndVerify(options, request);
      const result = await options.service.queueCommunication(
        actor,
        request.params.draftId,
        parseCrmOperationsIfMatchVersion(request.headers["if-match"]),
        request.headers["idempotency-key"],
        request.body,
      );
      setVersionEtag(reply, result.value.version);
      setIdempotencyReplay(reply, result.replayed);
      return result.value;
    },
  );

  app.get<{ Querystring: DashboardSummaryQuery }>(
    CRM_OPERATIONS_OPERATIONS["dashboard.get"].path,
    {
      schema: schemaFor("dashboard.get", {
        querystring: DashboardSummaryQuerySchema,
        response: { 200: DashboardSummarySchema },
      }),
    },
    async (request, reply) => {
      const actor = await options.resolveActor(request);
      reply.header("cache-control", "private, no-store");
      return options.service.getDashboardSummary(actor, request.query);
    },
  );

  app.get<{ Querystring: NotificationListQuery }>(
    CRM_OPERATIONS_OPERATIONS["notifications.list"].path,
    {
      schema: schemaFor("notifications.list", {
        querystring: NotificationListQuerySchema,
        response: { 200: NotificationPageSchema },
      }),
    },
    async (request) => {
      const actor = await options.resolveActor(request);
      return options.service.listNotifications(actor, request.query);
    },
  );

  app.post<{ Params: { notificationId: string }; Headers: VersionHeaders }>(
    CRM_OPERATIONS_OPERATIONS["notifications.read"].path,
    {
      schema: schemaFor(
        "notifications.read",
        {
          params: NotificationParamsSchema,
          headers: CrmOperationsVersionHeadersSchema,
          response: { 200: NotificationSchema },
        },
        {
          404: { $ref: "ErrorEnvelope#" },
          409: { $ref: "ErrorEnvelope#" },
          428: { $ref: "ErrorEnvelope#" },
        },
      ),
    },
    async (request, reply) => {
      const actor = await actorAndVerify(options, request);
      const value = await options.service.markNotificationRead(
        actor,
        request.params.notificationId,
        parseCrmOperationsIfMatchVersion(request.headers["if-match"]),
      );
      setVersionEtag(reply, value.version);
      return value;
    },
  );

  app.post<{ Headers: CreateHeaders; Body: RunReportBody }>(
    CRM_OPERATIONS_OPERATIONS["reports.run"].path,
    {
      schema: schemaFor("reports.run", {
        headers: CrmOperationsCreateHeadersSchema,
        body: RunReportBodySchema,
        response: { 200: ReportRunSchema, 201: ReportRunSchema },
      }),
    },
    async (request, reply) => {
      const actor = await actorAndVerify(options, request);
      const result = await options.service.runReport(actor, request.headers["idempotency-key"], request.body);
      setVersionEtag(reply, 1);
      setIdempotencyReplay(reply, result.replayed);
      return reply.status(result.replayed ? 200 : 201).send(result.value);
    },
  );

  app.get<{ Querystring: ReportRunListQuery }>(
    CRM_OPERATIONS_OPERATIONS["reports.list"].path,
    {
      schema: schemaFor("reports.list", {
        querystring: ReportRunListQuerySchema,
        response: { 200: ReportRunPageSchema },
      }),
    },
    async (request) => {
      const actor = await options.resolveActor(request);
      return options.service.listReportRuns(actor, request.query);
    },
  );

  app.get<{ Params: { reportRunId: string } }>(
    CRM_OPERATIONS_OPERATIONS["reports.get"].path,
    {
      schema: schemaFor(
        "reports.get",
        { params: ReportRunParamsSchema, response: { 200: ReportRunSchema } },
        { 404: { $ref: "ErrorEnvelope#" } },
      ),
    },
    async (request, reply) => {
      const actor = await options.resolveActor(request);
      const value = await options.service.getReportRun(actor, request.params.reportRunId);
      setVersionEtag(reply, 1);
      return value;
    },
  );

  app.post<{ Params: { reportRunId: string }; Headers: CreateHeaders }>(
    CRM_OPERATIONS_OPERATIONS["reports.export"].path,
    {
      schema: schemaFor(
        "reports.export",
        {
          params: ReportRunParamsSchema,
          headers: CrmOperationsCreateHeadersSchema,
          response: { 200: ReportExportSchema, 201: ReportExportSchema },
        },
        { 404: { $ref: "ErrorEnvelope#" }, 409: { $ref: "ErrorEnvelope#" } },
      ),
    },
    async (request, reply) => {
      const actor = await actorAndVerify(options, request);
      const result = await options.service.exportReport(
        actor,
        request.params.reportRunId,
        request.headers["idempotency-key"],
      );
      setIdempotencyReplay(reply, result.replayed);
      return reply.status(result.replayed ? 200 : 201).send(result.value);
    },
  );

  app.get<{ Params: { settingCode: CrmSettingCode } }>(
    CRM_OPERATIONS_OPERATIONS["settings.get"].path,
    {
      schema: schemaFor(
        "settings.get",
        { params: SettingParamsSchema, response: { 200: SettingVersionSchema } },
        { 404: { $ref: "ErrorEnvelope#" } },
      ),
    },
    async (request, reply) => {
      const actor = await options.resolveActor(request);
      const value = await options.service.getSetting(actor, request.params.settingCode);
      setVersionEtag(reply, value.version);
      return value;
    },
  );

  app.patch<{
    Params: { settingCode: CrmSettingCode };
    Headers: VersionHeaders;
    Body: UpdateSettingBody;
  }>(
    CRM_OPERATIONS_OPERATIONS["settings.update"].path,
    {
      schema: schemaFor(
        "settings.update",
        {
          params: SettingParamsSchema,
          headers: CrmOperationsVersionHeadersSchema,
          body: UpdateSettingBodySchema,
          response: { 200: SettingVersionSchema, 201: SettingVersionSchema },
        },
        {
          404: { $ref: "ErrorEnvelope#" },
          409: { $ref: "ErrorEnvelope#" },
          428: { $ref: "ErrorEnvelope#" },
        },
      ),
    },
    async (request, reply) => {
      const actor = await actorAndVerify(options, request);
      const expectedVersion = parseCrmOperationsIfMatchVersion(request.headers["if-match"], true);
      const value = await options.service.updateSetting(
        actor,
        request.params.settingCode,
        expectedVersion,
        request.body,
      );
      setVersionEtag(reply, value.version);
      return reply.status(expectedVersion === 0 ? 201 : 200).send(value);
    },
  );
}
