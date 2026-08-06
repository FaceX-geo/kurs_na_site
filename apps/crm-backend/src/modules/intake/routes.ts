import multipart, { type MultipartFile } from "@fastify/multipart";
import type { TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type {
  FastifyError,
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
  FastifySchema,
} from "fastify";
import { assertUploadLimitWithinStorageCeiling } from "../../common/upload-policy.js";
import { IntakeError } from "./errors.js";
import {
  ApplicationPayloadSchema,
  ApplicationReceiptSchema,
  CanonicalApplicationPayloadSchema,
  ErrorResponseSchema,
  type IdempotencyHeaders,
  IdempotencyHeadersSchema,
  MapPointListSchema,
  SphereListSchema,
  UploadMultipartBodySchema,
  UploadReceiptSchema,
  VacancyPageSchema,
  type VacancyQuery,
  VacancyQuerySchema,
} from "./schemas.js";
import type { IntakeService } from "./service.js";

interface OpenApiSchema extends FastifySchema {
  readonly tags?: readonly string[];
  readonly summary?: string;
  readonly description?: string;
  readonly operationId?: string;
  readonly deprecated?: boolean;
  readonly security?: readonly Readonly<Record<string, readonly string[]>>[];
  readonly consumes?: readonly string[];
}

interface VacancyRoute {
  readonly Querystring: VacancyQuery;
}

interface IdempotentRoute {
  readonly Headers: IdempotencyHeaders;
}

interface ApplicationRoute extends IdempotentRoute {
  readonly Body: unknown;
}

type UploadRoute = IdempotentRoute;

interface ValidationLikeError {
  readonly keyword: string;
  readonly instancePath: string;
  readonly schemaPath: string;
  readonly params: Record<string, unknown>;
  readonly message?: string;
}

interface ValidationFunction {
  (data: unknown): boolean | { readonly error?: Error | ValidationLikeError[]; readonly value?: unknown };
  errors?: ValidationLikeError[] | null;
}

export interface IntakePluginOptions {
  readonly service: IntakeService;
  readonly uploadMaxBytes: number;
  readonly aliases?: boolean;
  readonly allowedOrigins?: readonly string[];
  readonly rateLimit?: Partial<IntakeRateLimitPolicy>;
}

export interface IntakeRateLimitPolicy {
  readonly readMax: number;
  readonly uploadMax: number;
  readonly applicationMax: number;
  readonly timeWindow: string;
}

const DEFAULT_RATE_LIMIT: IntakeRateLimitPolicy = {
  readMax: 120,
  uploadMax: 10,
  applicationMax: 10,
  timeWindow: "1 minute",
};

const errorResponses = {
  400: ErrorResponseSchema,
  403: ErrorResponseSchema,
  409: ErrorResponseSchema,
  413: ErrorResponseSchema,
  415: ErrorResponseSchema,
  422: ErrorResponseSchema,
  429: ErrorResponseSchema,
  500: ErrorResponseSchema,
} as const;

function schemaErrors(schema: TSchema, data: unknown): ValidationLikeError[] {
  return [...Value.Errors(schema, data)].map((error) => ({
    keyword: `typebox_${error.type}`,
    instancePath: error.path,
    schemaPath: "",
    params: {},
    message: error.message,
  }));
}

function createValidatorCompiler() {
  return ({ schema }: { readonly schema: unknown }): ValidationFunction => {
    const typedSchema = schema as TSchema & { readonly $id?: string };

    // Application validation lives in the service so the payload is never mutated by AJV's
    // removeAdditional behavior before mixed relocation/student fields are inspected.
    if (
      typedSchema.$id === ApplicationPayloadSchema.$id ||
      typedSchema.$id === CanonicalApplicationPayloadSchema.$id
    ) {
      return (data) => ({ value: data });
    }

    if (typedSchema.$id === UploadMultipartBodySchema.$id) {
      // Multipart parsing is streaming and happens in the handler; this schema is the OpenAPI
      // contract while the handler enforces the same single-file invariant without buffering twice.
      return (data) => ({ value: data });
    }

    return (data) => {
      const errors = schemaErrors(typedSchema, data);
      return errors.length > 0 ? { error: errors } : { value: data };
    };
  };
}

async function readSingleUpload(
  request: FastifyRequest,
  uploadMaxBytes: number,
): Promise<{
  readonly file: MultipartFile;
  readonly bytes: Uint8Array;
}> {
  let upload: { readonly file: MultipartFile; readonly bytes: Uint8Array } | null = null;
  for await (const part of request.parts({
    limits: { fileSize: uploadMaxBytes, files: 1, fields: 0, parts: 1 },
  })) {
    if (part.type !== "file" || part.fieldname !== "file" || upload) {
      if (part.type === "file") {
        part.file.resume();
      }
      throw new IntakeError(422, "validation_error", "Validation failed", [
        {
          field: "file",
          code: "single_file_required",
          message: "Передайте ровно один файл в multipart-поле file.",
        },
      ]);
    }
    upload = { file: part, bytes: await part.toBuffer() };
  }

  if (!upload) {
    throw new IntakeError(422, "validation_error", "Validation failed", [
      { field: "file", code: "required", message: "Файл резюме обязателен." },
    ]);
  }
  return upload;
}

function fieldFromValidationPath(context: string | undefined, path: string): string {
  const field = path
    .replace(/^\//u, "")
    .split("/")
    .map((part) => part.replace(/~1/gu, "/").replace(/~0/gu, "~"))
    .join(".");
  return [context, field].filter(Boolean).join(".") || "request";
}

function validationItems(error: FastifyError) {
  return (error.validation ?? []).map((item) => ({
    field: fieldFromValidationPath(error.validationContext, item.instancePath),
    code: item.keyword,
    message: item.message ?? "Некорректное значение.",
  }));
}

function sendError(
  requestId: string,
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
  errors: readonly { readonly field: string; readonly code: string; readonly message: string }[] = [],
) {
  reply.header("x-request-id", requestId);
  return reply.status(statusCode).send({ code, message, requestId, errors });
}

function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof IntakeError) {
      return sendError(request.id, reply, error.statusCode, error.code, error.message, error.issues);
    }

    const fastifyError = error as FastifyError;
    if (fastifyError.validation) {
      return sendError(
        request.id,
        reply,
        422,
        "validation_error",
        "Validation failed",
        validationItems(fastifyError),
      );
    }

    if (
      fastifyError.code === "FST_REQ_FILE_TOO_LARGE" ||
      fastifyError.code === "FST_FILES_LIMIT" ||
      fastifyError.code === "FST_PARTS_LIMIT" ||
      fastifyError.code === "FST_FIELDS_LIMIT"
    ) {
      return sendError(request.id, reply, 413, "payload_too_large", "Файл превышает допустимый лимит.");
    }

    const statusCode =
      typeof fastifyError.statusCode === "number" && fastifyError.statusCode >= 400
        ? fastifyError.statusCode
        : 500;
    if (statusCode === 429) {
      return sendError(
        request.id,
        reply,
        429,
        "rate_limit_exceeded",
        "Слишком много запросов. Повторите позже.",
      );
    }

    if (statusCode >= 400 && statusCode < 500) {
      const code =
        statusCode === 413
          ? "payload_too_large"
          : statusCode === 415
            ? "unsupported_media_type"
            : "bad_request";
      const message =
        statusCode === 413
          ? "Запрос превышает допустимый размер."
          : statusCode === 415
            ? "Неподдерживаемый тип содержимого."
            : "Некорректный запрос.";
      return sendError(request.id, reply, statusCode, code, message);
    }

    request.log.error({ err: error, requestId: request.id }, "public intake request failed");
    return sendError(request.id, reply, 500, "internal_error", "Не удалось обработать запрос.");
  });
}

function operationSchema(options: {
  readonly operationId: string;
  readonly summary: string;
  readonly deprecated: boolean;
  readonly querystring?: TSchema;
  readonly headers?: TSchema;
  readonly body?: TSchema;
  readonly response: Readonly<Record<number, TSchema>>;
  readonly multipart?: boolean;
}): OpenApiSchema {
  return {
    tags: ["public-intake"],
    operationId: options.operationId,
    summary: options.summary,
    deprecated: options.deprecated,
    security: [],
    ...(options.querystring ? { querystring: options.querystring } : {}),
    ...(options.headers ? { headers: options.headers } : {}),
    ...(options.body ? { body: options.body } : {}),
    ...(options.multipart ? { consumes: ["multipart/form-data"] } : {}),
    response: options.response,
  };
}

function registerPrefixRoutes(
  app: FastifyInstance,
  options: IntakePluginOptions,
  prefix: "/public/v1" | "/api/v1",
  deprecated: boolean,
): void {
  const operationPrefix = deprecated ? "legacy" : "public";
  const rateLimit = { ...DEFAULT_RATE_LIMIT, ...options.rateLimit };
  const readRateLimit = {
    groupId: "public-intake-read",
    max: rateLimit.readMax,
    timeWindow: rateLimit.timeWindow,
  };

  app.get(
    `${prefix}/dictionaries/spheres`,
    {
      schema: operationSchema({
        operationId: `${operationPrefix}ListSpheres`,
        summary: "Список сфер для формы заявки",
        deprecated,
        response: { 200: SphereListSchema, ...errorResponses },
      }),
      config: { rateLimit: readRateLimit },
    },
    async () => options.service.listSpheres(),
  );

  app.get(
    `${prefix}/map-points`,
    {
      schema: operationSchema({
        operationId: `${operationPrefix}ListMapPoints`,
        summary: "Опубликованные точки карты",
        deprecated,
        response: { 200: MapPointListSchema, ...errorResponses },
      }),
      config: { rateLimit: readRateLimit },
    },
    async () => options.service.listMapPoints(),
  );

  app.get<VacancyRoute>(
    `${prefix}/vacancies`,
    {
      schema: operationSchema({
        operationId: `${operationPrefix}ListVacancies`,
        summary: "Опубликованные вакансии с cursor-пагинацией",
        deprecated,
        querystring: VacancyQuerySchema,
        response: { 200: VacancyPageSchema, ...errorResponses },
      }),
      config: { rateLimit: readRateLimit },
    },
    async (request) => options.service.listVacancies(request.query),
  );

  const registerUpload = (path: "/uploads" | "/files", pathDeprecated: boolean) => {
    const routeName = path === "/uploads" ? "UploadResume" : "UploadResumeFileAlias";
    app.post<UploadRoute>(
      `${prefix}${path}`,
      {
        schema: operationSchema({
          operationId: `${operationPrefix}${routeName}`,
          summary: "Загрузка резюме в карантинное хранилище",
          deprecated: deprecated || pathDeprecated,
          headers: IdempotencyHeadersSchema,
          body: UploadMultipartBodySchema,
          multipart: true,
          response: { 200: UploadReceiptSchema, 201: UploadReceiptSchema, ...errorResponses },
        }),
        config: {
          rateLimit: {
            groupId: "public-intake-upload",
            max: rateLimit.uploadMax,
            timeWindow: rateLimit.timeWindow,
          },
        },
        preValidation: async (request) => {
          if (!request.isMultipart()) {
            throw new IntakeError(
              415,
              "unsupported_media_type",
              "Ожидается multipart/form-data с полем file.",
            );
          }
        },
      },
      async (request, reply) => {
        const { file, bytes } = await readSingleUpload(request, options.uploadMaxBytes);
        const result = await options.service.storeUpload({
          idempotencyKey: request.headers["idempotency-key"],
          requestId: request.id,
          fileName: file.filename,
          mediaType: file.mimetype,
          bytes,
        });
        if (result.replayed) {
          reply.header("idempotency-replayed", "true");
        }
        return reply.code(result.replayed ? 200 : 201).send(result.value);
      },
    );
  };

  registerUpload("/uploads", false);
  registerUpload("/files", true);

  app.post<ApplicationRoute>(
    `${prefix}/applications`,
    {
      schema: operationSchema({
        operationId: deprecated ? "LegacyCreateApplication" : "CreateApplication",
        summary: "Создание заявки кандидата",
        deprecated,
        headers: IdempotencyHeadersSchema,
        body: deprecated ? ApplicationPayloadSchema : CanonicalApplicationPayloadSchema,
        response: {
          200: ApplicationReceiptSchema,
          201: ApplicationReceiptSchema,
          ...errorResponses,
        },
      }),
      config: {
        rateLimit: {
          groupId: "public-intake-application",
          max: rateLimit.applicationMax,
          timeWindow: rateLimit.timeWindow,
        },
      },
    },
    async (request, reply) => {
      const result = await options.service.createApplication({
        idempotencyKey: request.headers["idempotency-key"],
        requestId: request.id,
        payload: request.body,
        requireConsentEvidence: !deprecated,
        requireUploadBinding: !deprecated,
      });
      if (result.replayed) {
        reply.header("idempotency-replayed", "true");
      }
      return reply.code(result.replayed ? 200 : 201).send(result.value);
    },
  );
}

export const intakeRoutes: FastifyPluginAsync<IntakePluginOptions> = async (app, options) => {
  const uploadMaxBytes = assertUploadLimitWithinStorageCeiling(
    options.uploadMaxBytes,
    "Public intake route upload limit",
  );
  app.setValidatorCompiler(createValidatorCompiler());
  registerErrorHandling(app);

  if (!app.hasRequestDecorator("parts")) {
    await app.register(multipart, {
      throwFileSizeLimit: true,
      limits: {
        fileSize: uploadMaxBytes,
        files: 1,
        fields: 0,
        parts: 1,
      },
    });
  }

  const allowedOrigins = new Set(options.allowedOrigins ?? []);
  app.addHook("onRequest", async (request) => {
    const origin = request.headers.origin;
    if (origin && allowedOrigins.size > 0 && !allowedOrigins.has(origin)) {
      throw new IntakeError(403, "origin_not_allowed", "Источник запроса не разрешён.");
    }
  });

  app.addHook("onSend", async (request, reply, payload) => {
    reply.removeHeader("set-cookie");
    reply.removeHeader("access-control-allow-credentials");
    reply.header("x-request-id", request.id);
    return payload;
  });

  registerPrefixRoutes(app, options, "/public/v1", false);
  if (options.aliases !== false) {
    registerPrefixRoutes(app, options, "/api/v1", true);
  }
};
