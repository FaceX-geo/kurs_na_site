import { Type } from "@sinclair/typebox";
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export interface FieldError {
  field: string;
  code: string;
  message: string;
}

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly errors: readonly FieldError[];
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    options: { errors?: readonly FieldError[]; details?: Readonly<Record<string, unknown>> } = {},
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.errors = options.errors ?? [];
    this.details = options.details;
  }
}

export const FieldErrorSchema = Type.Object(
  {
    field: Type.String(),
    code: Type.String(),
    message: Type.String(),
  },
  { additionalProperties: false },
);

export const ErrorEnvelopeSchema = Type.Object(
  {
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    errors: Type.Optional(Type.Array(FieldErrorSchema)),
    details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: false, $id: "ErrorEnvelope" },
);

function validationErrors(error: FastifyError): FieldError[] {
  if (!error.validation) {
    return [];
  }

  return error.validation.map((issue) => ({
    field: issue.instancePath.replace(/^\//, "").replaceAll("/", ".") || "request",
    code: issue.keyword,
    message: issue.message ?? "Некорректное значение",
  }));
}

function sendError(
  request: FastifyRequest,
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
  errors: readonly FieldError[] = [],
  details?: Readonly<Record<string, unknown>>,
) {
  reply.header("x-request-id", request.id);
  return reply.status(statusCode).send({
    code,
    message,
    requestId: request.id,
    ...(errors.length > 0 ? { errors } : {}),
    ...(details ? { details } : {}),
  });
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.addSchema(ErrorEnvelopeSchema);

  app.setNotFoundHandler((request, reply) => {
    return sendError(request, reply, 404, "not_found", "Маршрут не найден");
  });

  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    if (error instanceof AppError) {
      return sendError(
        request,
        reply,
        error.statusCode,
        error.code,
        error.message,
        error.errors,
        error.details,
      );
    }

    if (error.validation) {
      return sendError(
        request,
        reply,
        422,
        "validation_error",
        "Проверьте заполнение полей",
        validationErrors(error),
      );
    }

    const statusCode =
      typeof error.statusCode === "number" && error.statusCode >= 400 ? error.statusCode : 500;
    if (statusCode === 429) {
      return sendError(request, reply, 429, "rate_limit_exceeded", "Слишком много запросов");
    }

    request.log.error({ err: error, requestId: request.id }, "request failed");
    return sendError(request, reply, statusCode, "internal_error", "Не удалось обработать запрос");
  });
}
