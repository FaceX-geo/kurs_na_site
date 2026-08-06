import type { Static, TSchema } from "@sinclair/typebox";
import type { FastifyInstance, FastifyRequest, FastifySchema } from "fastify";
import { ErrorEnvelopeSchema } from "../../common/errors.js";
import {
  CrmCaseDetailSchema,
  CrmEmployerDetailSchema,
  CrmReferralDetailSchema,
  CrmTaskDetailSchema,
} from "../crm/contracts.js";
import { parseCrmIfMatchVersion } from "../crm/plugin.js";
import type { CrmActorContext } from "../crm/ports.js";
import {
  CreateEmployerBodySchema,
  CreateReferralBodySchema,
  CreateTaskBodySchema,
  CrmCaseCommandParamsSchema,
  CrmCreateHeadersSchema,
  CrmMutationHeadersSchema,
  CrmReferralCommandParamsSchema,
  CrmTaskCommandParamsSchema,
  TransitionReferralBodySchema,
  UpdateCaseBodySchema,
  UpdateTaskBodySchema,
} from "./contracts.js";
import { CRM_COMMAND_OPERATIONS, type CrmCommandOperationKey } from "./registry.js";
import type { CrmCommandServicePort } from "./service.js";

export interface CrmCommandPluginOptions {
  readonly service: CrmCommandServicePort;
  readonly resolveActor: (request: FastifyRequest) => Promise<CrmActorContext>;
  readonly verifyMutationRequest: (request: FastifyRequest, actor: CrmActorContext) => Promise<void>;
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
  key: CrmCommandOperationKey,
  schema: FastifySchema,
): FastifySchema & { operationId: string; "x-permission-code": string } {
  const operation = CRM_COMMAND_OPERATIONS[key];
  return {
    ...schema,
    operationId: operation.operationId,
    summary: operation.summary,
    tags: ["crm"],
    security: [{ sessionCookie: [], csrfToken: [] }],
    "x-permission-code": operation.permissionCode,
    response: { ...errors, ...(schema.response ?? {}) },
  };
}

function setResultHeaders(
  reply: { header(name: string, value: string): unknown },
  version: number,
  replayed = false,
): void {
  reply.header("etag", `"v${version}"`);
  if (replayed) reply.header("idempotency-replayed", "true");
}

type CaseParams = Static<typeof CrmCaseCommandParamsSchema>;
type ReferralParams = Static<typeof CrmReferralCommandParamsSchema>;
type TaskParams = Static<typeof CrmTaskCommandParamsSchema>;
type CreateHeaders = Static<typeof CrmCreateHeadersSchema>;
type MutationHeaders = Static<typeof CrmMutationHeadersSchema>;

async function actorAndVerify(
  options: CrmCommandPluginOptions,
  request: FastifyRequest,
): Promise<CrmActorContext> {
  const actor = await options.resolveActor(request);
  await options.verifyMutationRequest(request, actor);
  return actor;
}

export async function crmCommandPlugin(
  app: FastifyInstance,
  options: CrmCommandPluginOptions,
): Promise<void> {
  if (!app.getSchema("ErrorEnvelope")) app.addSchema(ErrorEnvelopeSchema);

  app.patch<{ Params: CaseParams; Headers: MutationHeaders; Body: Static<typeof UpdateCaseBodySchema> }>(
    CRM_COMMAND_OPERATIONS["cases.update"].path,
    {
      schema: schemaFor("cases.update", {
        params: CrmCaseCommandParamsSchema,
        headers: CrmMutationHeadersSchema,
        body: UpdateCaseBodySchema,
        response: { 200: CrmCaseDetailSchema },
      }),
    },
    async (request, reply) => {
      const actor = await actorAndVerify(options, request);
      const value = await options.service.updateCase(
        actor,
        request.params.caseId,
        parseCrmIfMatchVersion(request.headers["if-match"]),
        request.body,
      );
      setResultHeaders(reply, value.version);
      return value;
    },
  );

  const registerCreate = <B extends TSchema, T extends { version: number }>(input: {
    key: "employers.create" | "referrals.create" | "tasks.create";
    body: B;
    response: TSchema;
    execute: (
      actor: CrmActorContext,
      idempotencyKey: string,
      body: Static<B>,
    ) => Promise<{ value: T; replayed: boolean }>;
  }) => {
    app.post<{ Headers: CreateHeaders; Body: Static<B> }>(
      CRM_COMMAND_OPERATIONS[input.key].path,
      {
        schema: schemaFor(input.key, {
          headers: CrmCreateHeadersSchema,
          body: input.body,
          response: { 200: input.response, 201: input.response },
        }),
      },
      async (request, reply) => {
        const actor = await actorAndVerify(options, request);
        const result = await input.execute(actor, request.headers["idempotency-key"], request.body);
        setResultHeaders(reply, result.value.version, result.replayed);
        return reply.status(result.replayed ? 200 : 201).send(result.value);
      },
    );
  };

  registerCreate({
    key: "employers.create",
    body: CreateEmployerBodySchema,
    response: CrmEmployerDetailSchema,
    execute: (actor, key, body) => options.service.createEmployer(actor, key, body),
  });
  registerCreate({
    key: "referrals.create",
    body: CreateReferralBodySchema,
    response: CrmReferralDetailSchema,
    execute: (actor, key, body) => options.service.createReferral(actor, key, body),
  });
  registerCreate({
    key: "tasks.create",
    body: CreateTaskBodySchema,
    response: CrmTaskDetailSchema,
    execute: (actor, key, body) => options.service.createTask(actor, key, body),
  });

  app.post<{
    Params: ReferralParams;
    Headers: MutationHeaders;
    Body: Static<typeof TransitionReferralBodySchema>;
  }>(
    CRM_COMMAND_OPERATIONS["referrals.transition"].path,
    {
      schema: schemaFor("referrals.transition", {
        params: CrmReferralCommandParamsSchema,
        headers: CrmMutationHeadersSchema,
        body: TransitionReferralBodySchema,
        response: { 200: CrmReferralDetailSchema },
      }),
    },
    async (request, reply) => {
      const actor = await actorAndVerify(options, request);
      const value = await options.service.transitionReferral(
        actor,
        request.params.referralId,
        parseCrmIfMatchVersion(request.headers["if-match"]),
        request.body,
      );
      setResultHeaders(reply, value.version);
      return value;
    },
  );

  app.patch<{ Params: TaskParams; Headers: MutationHeaders; Body: Static<typeof UpdateTaskBodySchema> }>(
    CRM_COMMAND_OPERATIONS["tasks.update"].path,
    {
      schema: schemaFor("tasks.update", {
        params: CrmTaskCommandParamsSchema,
        headers: CrmMutationHeadersSchema,
        body: UpdateTaskBodySchema,
        response: { 200: CrmTaskDetailSchema },
      }),
    },
    async (request, reply) => {
      const actor = await actorAndVerify(options, request);
      const value = await options.service.updateTask(
        actor,
        request.params.taskId,
        parseCrmIfMatchVersion(request.headers["if-match"]),
        request.body,
      );
      setResultHeaders(reply, value.version);
      return value;
    },
  );
}
