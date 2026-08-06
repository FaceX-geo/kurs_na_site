import { type Static, Type } from "@sinclair/typebox";
import type { FastifyPluginAsync, FastifyReply, FastifySchema } from "fastify";
import { ErrorEnvelopeSchema } from "../../common/errors.js";
import type { AppConfig } from "../../config/env.js";
import type { DatabaseHandle } from "../../db/client.js";
import type { IdentityAdminService } from "./admin-service.js";
import { IDENTITY_OPERATIONS } from "./operation-registry.js";
import { type AuthContext, IdentityService, type SessionReceipt as SessionReceiptValue } from "./service.js";
import {
  OwnSessionItemSchema,
  SessionListQuerySchema,
  SessionPageMetadataSchema,
} from "./session-contracts.js";

const LoginBody = Type.Object(
  {
    login: Type.String({ minLength: 3, maxLength: 254 }),
    password: Type.String({ minLength: 8, maxLength: 1024 }),
  },
  { additionalProperties: false },
);

const MfaBody = Type.Union([
  Type.Object(
    {
      challengeId: Type.String({ minLength: 10, maxLength: 96 }),
      challengeToken: Type.String({ minLength: 32, maxLength: 128 }),
      code: Type.String({ pattern: "^[0-9]{6}$" }),
    },
    {
      additionalProperties: false,
      description: "Публичное завершение MFA-входа по одноразовому challenge token.",
    },
  ),
  Type.Object(
    {
      challengeId: Type.String({ minLength: 10, maxLength: 96 }),
      challengeToken: Type.String({ minLength: 32, maxLength: 128 }),
      recoveryCode: Type.String({ minLength: 10, maxLength: 64 }),
    },
    {
      additionalProperties: false,
      description: "Публичное восстановление MFA по одноразовому challenge token и recovery code.",
    },
  ),
  Type.Object(
    {
      password: Type.String({ minLength: 8, maxLength: 1024 }),
      mfaCode: Type.String({ pattern: "^[0-9]{6}$" }),
    },
    {
      additionalProperties: false,
      description:
        "Повторная аутентификация действующей сессии. Требует sessionCookie, X-CSRF-Token и доверенный Origin/Referer.",
    },
  ),
]);

const SessionReceipt = Type.Object({
  status: Type.Literal("authenticated"),
  csrfToken: Type.String(),
  expiresAt: Type.String({ format: "date-time" }),
  user: Type.Object({
    id: Type.String({ format: "uuid" }),
    email: Type.String({ format: "email" }),
    displayName: Type.String(),
    roles: Type.Array(Type.String()),
  }),
});

const SessionPageResponse = Type.Object(
  {
    items: Type.Array(OwnSessionItemSchema),
    page: SessionPageMetadataSchema,
  },
  { additionalProperties: false },
);

export interface IdentityPluginOptions {
  config: AppConfig;
  database: DatabaseHandle;
  service?: IdentityService;
  adminService?: Pick<IdentityAdminService, "recoverMfa">;
}

function setSessionCookie(reply: FastifyReply, config: AppConfig, token: string, expiresAt: string): void {
  reply.header("cache-control", "no-store");
  reply.setCookie(config.session.cookieName, token, {
    path: "/internal/v1",
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: "lax",
    expires: new Date(expiresAt),
  });
}

export const identityPlugin: FastifyPluginAsync<IdentityPluginOptions> = async (app, options) => {
  const service = options.service ?? new IdentityService(options.database.db, options.config);

  app.post<{ Body: Static<typeof LoginBody> }>(
    "/internal/v1/auth/login",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        operationId: "Login",
        tags: ["identity"],
        body: LoginBody,
        response: {
          200: SessionReceipt,
          202: Type.Union([
            Type.Object({
              status: Type.Literal("mfa_required"),
              challengeId: Type.String(),
              challengeToken: Type.String(),
              provider: Type.Union([Type.Literal("totp"), Type.Literal("max_otp")]),
              expiresAt: Type.String({ format: "date-time" }),
            }),
            Type.Object({
              status: Type.Literal("mfa_enrollment_required"),
              challengeId: Type.String(),
              challengeToken: Type.String(),
              expiresAt: Type.String({ format: "date-time" }),
            }),
          ]),
          401: ErrorEnvelopeSchema,
          403: ErrorEnvelopeSchema,
          429: ErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      const result = await service.login(request.body.login, request.body.password);
      if (result.status !== "authenticated") {
        return reply.status(202).send(result);
      }
      setSessionCookie(reply, options.config, result.receipt.sessionToken, result.receipt.expiresAt);
      return reply.send({
        status: "authenticated",
        csrfToken: result.receipt.csrfToken,
        expiresAt: result.receipt.expiresAt,
        user: result.receipt.user,
      });
    },
  );

  app.post<{ Body: Static<typeof MfaBody>; Headers: { "x-csrf-token"?: string } }>(
    IDENTITY_OPERATIONS["mfa.verify"].path,
    {
      config: { rateLimit: { max: 10, timeWindow: "5 minutes" } },
      schema: {
        operationId: IDENTITY_OPERATIONS["mfa.verify"].operationId,
        tags: ["identity"],
        summary: "Завершить MFA-вход, восстановление или повторную аутентификацию",
        description:
          "Challenge и recovery branches являются публичными и защищены одноразовым challenge token. Reauthentication branch требует действующую session cookie, X-CSRF-Token и доверенный Origin/Referer; пустое security requirement описывает только публичные branches.",
        security: [{}, { sessionCookie: [], csrfToken: [] }],
        body: MfaBody,
        headers: Type.Object(
          { "x-csrf-token": Type.Optional(Type.String({ minLength: 32, maxLength: 256 })) },
          { additionalProperties: true },
        ),
        response: {
          200: SessionReceipt,
          401: ErrorEnvelopeSchema,
          403: ErrorEnvelopeSchema,
          409: ErrorEnvelopeSchema,
          429: ErrorEnvelopeSchema,
          503: ErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      let receipt: SessionReceiptValue;
      if ("password" in request.body) {
        const context = await service.authenticate(request);
        service.assertTrustedMutation(request, context, request.headers["x-csrf-token"]);
        receipt = await service.reauthenticate(context, request.body.password, request.body.mfaCode);
      } else if ("recoveryCode" in request.body) {
        if (!options.adminService) {
          throw new Error("Identity admin service is required for recovery-code verification");
        }
        receipt = await options.adminService.recoverMfa(request.body, { requestId: request.id });
      } else {
        receipt = await service.verifyMfa(
          request.body.challengeId,
          request.body.challengeToken,
          request.body.code,
        );
      }
      setSessionCookie(reply, options.config, receipt.sessionToken, receipt.expiresAt);
      return reply.send({
        status: "authenticated",
        csrfToken: receipt.csrfToken,
        expiresAt: receipt.expiresAt,
        user: receipt.user,
      });
    },
  );

  async function authenticated(request: Parameters<typeof service.authenticate>[0]) {
    return service.authenticate(request);
  }

  app.get(
    "/internal/v1/auth/session",
    {
      schema: {
        operationId: "GetOwnProfile",
        tags: ["identity"],
        security: [{ sessionCookie: [] }],
        response: {
          200: Type.Object({
            userAccountId: Type.String({ format: "uuid" }),
            email: Type.String({ format: "email" }),
            authenticationLevel: Type.String(),
            roles: Type.Array(Type.String()),
            permissions: Type.Array(Type.String()),
          }),
          401: ErrorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const context = await authenticated(request);
      return {
        userAccountId: context.userAccountId,
        email: context.email,
        authenticationLevel: context.authenticationLevel,
        roles: context.roles,
        permissions: context.permissions,
      };
    },
  );

  app.get<{ Querystring: Static<typeof SessionListQuerySchema> }>(
    IDENTITY_OPERATIONS["sessions.list_own"].path,
    {
      schema: {
        operationId: IDENTITY_OPERATIONS["sessions.list_own"].operationId,
        tags: ["identity"],
        security: [{ sessionCookie: [] }],
        "x-access-scope": IDENTITY_OPERATIONS["sessions.list_own"].access,
        querystring: SessionListQuerySchema,
        response: {
          200: SessionPageResponse,
          401: ErrorEnvelopeSchema,
          422: ErrorEnvelopeSchema,
        },
      } as FastifySchema & { readonly "x-access-scope": "authenticated_self" },
    },
    async (request) => {
      const context = await authenticated(request);
      return service.listSessions(context, request.query);
    },
  );

  app.post<{ Headers: { "x-csrf-token": string } }>(
    "/internal/v1/auth/logout",
    {
      schema: {
        operationId: "Logout",
        tags: ["identity"],
        security: [{ sessionCookie: [], csrfToken: [] }],
        headers: Type.Object(
          { "x-csrf-token": Type.String({ minLength: 32, maxLength: 256 }) },
          { additionalProperties: true },
        ),
        response: { 204: Type.Null(), 401: ErrorEnvelopeSchema, 403: ErrorEnvelopeSchema },
      },
    },
    async (request, reply) => {
      const context: AuthContext = await authenticated(request);
      service.assertTrustedMutation(request, context, request.headers["x-csrf-token"]);
      await service.logoutCurrentSession(context);
      reply.clearCookie(options.config.session.cookieName, { path: "/internal/v1" });
      return reply.status(204).send();
    },
  );

  app.post<{
    Params: { sessionId: string };
    Headers: { "x-csrf-token": string };
    Body: { reason: string };
  }>(
    "/internal/v1/auth/sessions/:sessionId/revoke",
    {
      schema: {
        operationId: "RevokeOwnSession",
        tags: ["identity"],
        security: [{ sessionCookie: [], csrfToken: [] }],
        params: Type.Object({ sessionId: Type.String({ format: "uuid" }) }),
        headers: Type.Object({ "x-csrf-token": Type.String() }, { additionalProperties: true }),
        body: Type.Object({ reason: Type.String({ minLength: 3, maxLength: 500 }) }),
        response: { 204: Type.Null(), 401: ErrorEnvelopeSchema, 403: ErrorEnvelopeSchema },
      },
    },
    async (request, reply) => {
      const context: AuthContext = await authenticated(request);
      service.assertTrustedMutation(request, context, request.headers["x-csrf-token"]);
      await service.revokeSession(context, request.params.sessionId, request.body.reason);
      if (request.params.sessionId === context.sessionId) {
        reply.clearCookie(options.config.session.cookieName, { path: "/internal/v1" });
      }
      return reply.status(204).send();
    },
  );
};
