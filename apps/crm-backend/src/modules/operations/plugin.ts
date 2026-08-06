import type { FastifyInstance, FastifyRequest, FastifySchema } from "fastify";
import { ErrorEnvelopeSchema } from "../../common/errors.js";
import {
  type AuditEventListQuery,
  AuditEventListQuerySchema,
  AuditEventPageSchema,
  type MigrationConflictListQuery,
  MigrationConflictListQuerySchema,
  MigrationConflictPageSchema,
  MigrationConflictParamsSchema,
  MigrationConflictSchema,
  type MigrationRunListQuery,
  MigrationRunListQuerySchema,
  MigrationRunPageSchema,
  MigrationRunParamsSchema,
  MigrationRunSchema,
  PrometheusMetricsSchema,
} from "./contracts.js";
import type { OperationsActorContext, OperationsReadServicePort } from "./ports.js";
import { OPERATIONS, type OperationsOperationKey } from "./registry.js";

export type OperationsActorResolver = (request: FastifyRequest) => Promise<OperationsActorContext>;

export interface OperationsPluginOptions {
  readonly service: OperationsReadServicePort;
  readonly resolveActor: OperationsActorResolver;
}

type OperationsRouteSchema = FastifySchema & {
  readonly operationId: string;
  readonly "x-permission-code": string;
  readonly "x-data-classification": "redacted" | "aggregate";
};

const commonErrors = {
  401: { $ref: "ErrorEnvelope#" },
  403: { $ref: "ErrorEnvelope#" },
  422: { $ref: "ErrorEnvelope#" },
  500: { $ref: "ErrorEnvelope#" },
} as const;

function schemaFor(
  key: OperationsOperationKey,
  schema: FastifySchema,
  classification: OperationsRouteSchema["x-data-classification"] = "redacted",
  extraErrors: Readonly<Record<number, { readonly $ref: string }>> = {},
): OperationsRouteSchema {
  const operation = OPERATIONS[key];
  return {
    ...schema,
    operationId: operation.operationId,
    summary: operation.summary,
    tags: [operation.tag],
    security: [{ sessionCookie: [] }],
    "x-permission-code": operation.permissionCode,
    "x-data-classification": classification,
    response: {
      ...commonErrors,
      ...extraErrors,
      ...(schema.response ?? {}),
    },
  };
}

function noStore(reply: { header(name: string, value: string): unknown }): void {
  reply.header("cache-control", "private, no-store");
  reply.header("pragma", "no-cache");
}

export async function operationsPlugin(
  app: FastifyInstance,
  options: OperationsPluginOptions,
): Promise<void> {
  if (!app.getSchema("ErrorEnvelope")) {
    app.addSchema(ErrorEnvelopeSchema);
  }

  app.get<{ Querystring: MigrationRunListQuery }>(
    OPERATIONS["migration.runs.list"].path,
    {
      schema: schemaFor("migration.runs.list", {
        querystring: MigrationRunListQuerySchema,
        response: { 200: MigrationRunPageSchema },
      }),
    },
    async (request, reply) => {
      noStore(reply);
      const actor = await options.resolveActor(request);
      return options.service.listMigrationRuns(actor, request.query);
    },
  );

  app.get<{ Params: { runId: string } }>(
    OPERATIONS["migration.runs.get"].path,
    {
      schema: schemaFor(
        "migration.runs.get",
        { params: MigrationRunParamsSchema, response: { 200: MigrationRunSchema } },
        "redacted",
        { 404: { $ref: "ErrorEnvelope#" } },
      ),
    },
    async (request, reply) => {
      noStore(reply);
      const actor = await options.resolveActor(request);
      return options.service.getMigrationRun(actor, request.params.runId);
    },
  );

  app.get<{ Querystring: MigrationConflictListQuery }>(
    OPERATIONS["migration.conflicts.list"].path,
    {
      schema: schemaFor("migration.conflicts.list", {
        querystring: MigrationConflictListQuerySchema,
        response: { 200: MigrationConflictPageSchema },
      }),
    },
    async (request, reply) => {
      noStore(reply);
      const actor = await options.resolveActor(request);
      return options.service.listMigrationConflicts(actor, request.query);
    },
  );

  app.get<{ Params: { conflictId: string } }>(
    OPERATIONS["migration.conflicts.get"].path,
    {
      schema: schemaFor(
        "migration.conflicts.get",
        { params: MigrationConflictParamsSchema, response: { 200: MigrationConflictSchema } },
        "redacted",
        { 404: { $ref: "ErrorEnvelope#" } },
      ),
    },
    async (request, reply) => {
      noStore(reply);
      const actor = await options.resolveActor(request);
      return options.service.getMigrationConflict(actor, request.params.conflictId);
    },
  );

  app.get<{ Querystring: AuditEventListQuery }>(
    OPERATIONS["audit.events.list"].path,
    {
      schema: schemaFor("audit.events.list", {
        querystring: AuditEventListQuerySchema,
        response: { 200: AuditEventPageSchema },
      }),
    },
    async (request, reply) => {
      noStore(reply);
      const actor = await options.resolveActor(request);
      return options.service.listAuditEvents(actor, request.query);
    },
  );

  app.get(
    OPERATIONS["metrics.read"].path,
    {
      schema: schemaFor("metrics.read", { response: { 200: PrometheusMetricsSchema } }, "aggregate"),
    },
    async (request, reply) => {
      noStore(reply);
      const actor = await options.resolveActor(request);
      const body = await options.service.readMetrics(actor);
      return reply.type("text/plain; version=0.0.4; charset=utf-8").send(body);
    },
  );
}
