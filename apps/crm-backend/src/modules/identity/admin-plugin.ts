import { type Static, Type } from "@sinclair/typebox";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest, FastifySchema } from "fastify";
import { ErrorEnvelopeSchema } from "../../common/errors.js";
import type { AppConfig } from "../../config/env.js";
import type { DatabaseHandle } from "../../db/client.js";
import type { RoleChangeInput } from "./admin-contracts.js";
import { ROLE_OPERATION_LIST, ROLE_PREVIEW_OPERATION } from "./admin-role-registry.js";
import { IdentityAdminService } from "./admin-service.js";
import { IDENTITY_OPERATIONS } from "./operation-registry.js";
import { type AuthContext, IdentityService, type SessionReceipt } from "./service.js";
import {
  AdminSessionItemSchema,
  SessionListQueryProperties,
  SessionPageMetadataSchema,
} from "./session-contracts.js";

const Uuid = Type.String({ format: "uuid" });
const DateTime = Type.String({ format: "date-time" });
const Reason = Type.String({ minLength: 3, maxLength: 1_000 });
const CsrfHeaders = Type.Object(
  { "x-csrf-token": Type.String({ minLength: 32, maxLength: 256 }) },
  { additionalProperties: true },
);
const UserParams = Type.Object({ userId: Uuid }, { additionalProperties: false });
const ApprovalParams = Type.Object({ approvalId: Type.String({ minLength: 20, maxLength: 96 }) });

type PermissionRouteSchema = FastifySchema & {
  readonly operationId: string;
  readonly "x-permission-code": string;
};

const CredentialBody = Type.Object(
  {
    token: Type.String({ minLength: 50, maxLength: 256 }),
    password: Type.String({ minLength: 12, maxLength: 256 }),
  },
  { additionalProperties: false },
);
const InviteBody = Type.Object(
  {
    email: Type.String({ format: "email", maxLength: 254 }),
    givenName: Type.String({ minLength: 1, maxLength: 120 }),
    surname: Type.String({ minLength: 1, maxLength: 120 }),
    middleName: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    reason: Reason,
  },
  { additionalProperties: false },
);
const VersionedReasonBody = Type.Object(
  {
    expectedVersion: Type.Integer({ minimum: 1 }),
    reason: Reason,
    approvalRequestId: Type.Optional(Type.String({ minLength: 20, maxLength: 96 })),
    transferRef: Type.Optional(Type.String({ minLength: 3, maxLength: 256 })),
  },
  { additionalProperties: false },
);
const ReasonBody = Type.Object({ reason: Reason }, { additionalProperties: false });
const TotpEnrollmentBody = Type.Union([
  Type.Object(
    {
      action: Type.Literal("start"),
      challengeId: Type.String({ minLength: 10, maxLength: 96 }),
      challengeToken: Type.String({ minLength: 32, maxLength: 128 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("confirm"),
      challengeId: Type.String({ minLength: 10, maxLength: 96 }),
      challengeToken: Type.String({ minLength: 32, maxLength: 128 }),
      code: Type.String({ pattern: "^[0-9]{6}$" }),
    },
    { additionalProperties: false },
  ),
]);
const ChangePasswordBody = Type.Object(
  {
    currentPassword: Type.String({ minLength: 8, maxLength: 256 }),
    newPassword: Type.String({ minLength: 12, maxLength: 256 }),
    mfaCode: Type.Optional(Type.String({ pattern: "^[0-9]{6}$" })),
  },
  { additionalProperties: false },
);
const DecideApprovalBody = Type.Object(
  {
    decision: Type.Union([Type.Literal("approve"), Type.Literal("reject")]),
    expectedVersion: Type.Integer({ minimum: 1 }),
    reason: Reason,
  },
  { additionalProperties: false },
);
const RoleScopeTypeSchema = Type.Union([
  Type.Literal("self"),
  Type.Literal("assigned"),
  Type.Literal("team"),
  Type.Literal("department"),
  Type.Literal("direction"),
  Type.Literal("project"),
  Type.Literal("all"),
]);
const RoleOperationKeySchema = Type.Union([
  Type.Literal("assign_platform"),
  Type.Literal("assign_crm"),
  Type.Literal("revoke_crm"),
  Type.Literal("assign_project"),
  Type.Literal("revoke_project"),
  Type.Literal("assign_initial_crm_admin"),
  Type.Literal("assign_initial_project_admin"),
  Type.Literal("assign_crm_admin"),
  Type.Literal("assign_project_admin"),
  Type.Literal("revoke_platform"),
  Type.Literal("revoke_crm_admin"),
  Type.Literal("revoke_project_admin"),
  Type.Literal("assign_migration"),
  Type.Literal("revoke_migration"),
  Type.Literal("assign_audit"),
  Type.Literal("revoke_audit"),
]);
const RolePreviewBody = Type.Object(
  {
    operationKey: RoleOperationKeySchema,
    roleCode: Type.Optional(Type.String({ minLength: 3, maxLength: 100 })),
    scopeType: RoleScopeTypeSchema,
    scopeId: Type.Optional(Uuid),
    expectedVersion: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);
const RoleChangeCoreProperties = {
  scopeType: RoleScopeTypeSchema,
  scopeId: Type.Optional(Uuid),
  expectedVersion: Type.Integer({ minimum: 1 }),
  reason: Reason,
  previewFingerprint: Type.String({ pattern: "^[a-f0-9]{64}$" }),
} as const;

const SessionReceiptSchema = Type.Object(
  {
    status: Type.Literal("authenticated"),
    csrfToken: Type.String(),
    expiresAt: DateTime,
    user: Type.Object({
      id: Uuid,
      email: Type.String({ format: "email" }),
      displayName: Type.String(),
      roles: Type.Array(Type.String()),
    }),
  },
  { additionalProperties: false },
);
const MfaEnrollmentCompletedSchema = Type.Object(
  {
    status: Type.Literal("authenticated"),
    csrfToken: Type.String(),
    expiresAt: DateTime,
    user: Type.Object({
      id: Uuid,
      email: Type.String({ format: "email" }),
      displayName: Type.String(),
      roles: Type.Array(Type.String()),
    }),
    recoveryCodes: Type.Array(Type.String(), { minItems: 10, maxItems: 10 }),
  },
  { additionalProperties: false },
);
const UserSchema = Type.Object(
  {
    id: Uuid,
    displayName: Type.String(),
    email: Type.String({ format: "email" }),
    username: Type.Union([Type.String(), Type.Null()]),
    accountState: Type.String(),
    credentialState: Type.String(),
    riskState: Type.String(),
    mfaState: Type.String(),
    employmentState: Type.Union([Type.String(), Type.Null()]),
    roles: Type.Array(Type.String()),
    activeSessions: Type.Integer({ minimum: 0 }),
    version: Type.Integer({ minimum: 1 }),
    createdAt: DateTime,
    updatedAt: DateTime,
  },
  { additionalProperties: false },
);
const PageSchema = Type.Object(
  {
    limit: Type.Integer({ minimum: 1, maximum: 200 }),
    nextCursor: Type.Union([Type.String(), Type.Null()]),
    hasMore: Type.Boolean(),
  },
  { additionalProperties: false },
);
const AdminSessionListQuerySchema = Type.Object(
  { ...SessionListQueryProperties, reason: Reason },
  { additionalProperties: false },
);
const AdminSessionPageResponse = Type.Object(
  { items: Type.Array(AdminSessionItemSchema), page: SessionPageMetadataSchema },
  { additionalProperties: false },
);
const AdminOperationSchema = Type.Object(
  {
    status: Type.Union([Type.Literal("completed"), Type.Literal("approval_required")]),
    resourceId: Uuid,
    version: Type.Optional(Type.Integer({ minimum: 1 })),
    approval: Type.Optional(
      Type.Object({ id: Type.String(), expiresAt: DateTime }, { additionalProperties: false }),
    ),
  },
  { additionalProperties: false },
);
const ApprovalSchema = Type.Object(
  {
    id: Type.String(),
    proposerId: Uuid,
    approverId: Type.Union([Uuid, Type.Null()]),
    subjectId: Type.Union([Uuid, Type.Null()]),
    operationCode: Type.String(),
    permissionCode: Type.String(),
    scope: Type.Object(
      {
        scope: RoleScopeTypeSchema,
        expectedVersion: Type.Integer({ minimum: 1 }),
        roleCode: Type.Optional(Type.String()),
        scopeType: Type.Optional(RoleScopeTypeSchema),
        scopeId: Type.Optional(Uuid),
        previewFingerprint: Type.Optional(Type.String({ pattern: "^[a-f0-9]{64}$" })),
        nominationRef: Type.Optional(Type.String()),
        transferRef: Type.Optional(Type.String()),
      },
      { additionalProperties: false },
    ),
    reason: Type.String(),
    state: Type.String(),
    expiresAt: DateTime,
    version: Type.Integer({ minimum: 1 }),
    createdAt: DateTime,
  },
  { additionalProperties: false },
);
const EffectiveRoleAssignmentSchema = Type.Object(
  {
    id: Type.Union([Uuid, Type.Null()]),
    roleCode: Type.String(),
    domain: Type.String(),
    privileged: Type.Boolean(),
    scopeType: RoleScopeTypeSchema,
    scopeId: Type.Union([Uuid, Type.Null()]),
    validFrom: Type.Union([DateTime, Type.Null()]),
    version: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  },
  { additionalProperties: false },
);
const EffectiveAccessPreviewSchema = Type.Object(
  {
    userId: Uuid,
    accountVersion: Type.Integer({ minimum: 1 }),
    policyVersion: Type.String(),
    domain: Type.Union([
      Type.Literal("platform"),
      Type.Literal("crm"),
      Type.Literal("project"),
      Type.Literal("migration"),
      Type.Literal("audit"),
    ]),
    operationKey: RoleOperationKeySchema,
    operationId: Type.String(),
    action: Type.Union([Type.Literal("assign"), Type.Literal("revoke")]),
    roleCode: Type.String(),
    scopeType: RoleScopeTypeSchema,
    scopeId: Type.Union([Uuid, Type.Null()]),
    currentAssignments: Type.Array(EffectiveRoleAssignmentSchema),
    proposedAssignments: Type.Array(EffectiveRoleAssignmentSchema),
    currentPermissions: Type.Array(Type.String()),
    proposedPermissions: Type.Array(Type.String()),
    addedPermissions: Type.Array(Type.String()),
    removedPermissions: Type.Array(Type.String()),
    requiresApproval: Type.Boolean(),
    approverRole: Type.Union([Type.String(), Type.Null()]),
    previewFingerprint: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  },
  { additionalProperties: false },
);

export interface IdentityAdminPluginOptions {
  readonly config: AppConfig;
  readonly database: DatabaseHandle;
  readonly authService?: IdentityService;
  readonly service?: IdentityAdminService;
}

function setSessionCookie(reply: FastifyReply, config: AppConfig, receipt: SessionReceipt): void {
  reply.header("cache-control", "no-store");
  reply.setCookie(config.session.cookieName, receipt.sessionToken, {
    path: "/internal/v1",
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: "lax",
    expires: new Date(receipt.expiresAt),
  });
}

function publicReceipt(receipt: SessionReceipt) {
  return {
    status: "authenticated" as const,
    csrfToken: receipt.csrfToken,
    expiresAt: receipt.expiresAt,
    user: receipt.user,
  };
}

export const identityAdminPlugin: FastifyPluginAsync<IdentityAdminPluginOptions> = async (app, options) => {
  const auth = options.authService ?? new IdentityService(options.database.db, options.config);
  const service = options.service ?? new IdentityAdminService(options.database.db, options.config, auth);

  async function authenticated(request: FastifyRequest): Promise<AuthContext> {
    return auth.authenticate(request);
  }

  async function protectedContext(
    request: FastifyRequest & { headers: { "x-csrf-token"?: string } },
  ): Promise<AuthContext> {
    const context = await authenticated(request);
    auth.assertTrustedMutation(request, context, request.headers["x-csrf-token"]);
    return context;
  }

  app.post<{ Body: Static<typeof CredentialBody> }>(
    "/internal/v1/auth/invite/accept",
    {
      config: { rateLimit: { max: 10, timeWindow: "10 minutes" } },
      schema: {
        operationId: "AcceptInvite",
        tags: ["identity"],
        body: CredentialBody,
        response: {
          200: Type.Object({ status: Type.Literal("password_set") }),
          403: ErrorEnvelopeSchema,
          410: ErrorEnvelopeSchema,
          422: ErrorEnvelopeSchema,
          429: ErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return service.acceptCredential(request.body, "invite", { requestId: request.id });
    },
  );

  app.post<{ Body: Static<typeof CredentialBody> }>(
    "/internal/v1/auth/password/reset/complete",
    {
      config: { rateLimit: { max: 10, timeWindow: "10 minutes" } },
      schema: {
        operationId: "CompletePasswordReset",
        tags: ["identity"],
        body: CredentialBody,
        response: {
          200: Type.Object({ status: Type.Literal("password_set") }),
          403: ErrorEnvelopeSchema,
          410: ErrorEnvelopeSchema,
          422: ErrorEnvelopeSchema,
          429: ErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return service.acceptCredential(request.body, "reset", { requestId: request.id });
    },
  );

  app.post<{ Body: Static<typeof TotpEnrollmentBody> }>(
    "/internal/v1/auth/mfa/enrollment",
    {
      config: { rateLimit: { max: 10, timeWindow: "10 minutes" } },
      schema: {
        operationId: "EnrollMfa",
        tags: ["identity"],
        body: TotpEnrollmentBody,
        response: {
          200: Type.Union([
            Type.Object({
              status: Type.Literal("enrollment_started"),
              secret: Type.String(),
              uri: Type.String(),
              expiresAt: DateTime,
            }),
            MfaEnrollmentCompletedSchema,
          ]),
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
      if (request.body.action === "start") {
        const started = await service.beginTotpEnrollment(request.body, { requestId: request.id });
        return { status: "enrollment_started" as const, ...started };
      }
      const completed = await service.confirmTotpEnrollment(request.body, { requestId: request.id });
      setSessionCookie(reply, options.config, completed.session);
      return { ...publicReceipt(completed.session), recoveryCodes: completed.recoveryCodes };
    },
  );

  app.post<{ Body: Static<typeof ChangePasswordBody>; Headers: Static<typeof CsrfHeaders> }>(
    "/internal/v1/auth/password/change",
    {
      schema: {
        operationId: "ChangeOwnPassword",
        tags: ["identity"],
        security: [{ sessionCookie: [], csrfToken: [] }],
        headers: CsrfHeaders,
        body: ChangePasswordBody,
        response: {
          200: SessionReceiptSchema,
          401: ErrorEnvelopeSchema,
          403: ErrorEnvelopeSchema,
          422: ErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      const context = await protectedContext(request);
      const receipt = await service.changeOwnPassword(context, request.body, { requestId: request.id });
      setSessionCookie(reply, options.config, receipt);
      return publicReceipt(receipt);
    },
  );

  app.post<{ Body: Static<typeof InviteBody>; Headers: Static<typeof CsrfHeaders> }>(
    "/internal/v1/admin/users/invitations",
    {
      schema: {
        operationId: "InviteUser",
        tags: ["identity-admin"],
        security: [{ sessionCookie: [], csrfToken: [] }],
        headers: CsrfHeaders,
        body: InviteBody,
        response: {
          202: Type.Object({ userId: Uuid, expiresAt: DateTime }),
          401: ErrorEnvelopeSchema,
          403: ErrorEnvelopeSchema,
          409: ErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const context = await protectedContext(request);
      const result = await service.inviteUser(context, request.body, { requestId: request.id });
      return reply.status(202).send(result);
    },
  );

  app.get<{
    Querystring: {
      cursor?: string;
      limit?: number;
      search?: string;
      accountState?: "active" | "disabled" | "archived";
      mfaState?: "not_enrolled" | "enrollment_required" | "enrolled" | "recovery_required";
    };
  }>(
    "/internal/v1/admin/users",
    {
      schema: {
        operationId: "ListUsers",
        tags: ["identity-admin"],
        security: [{ sessionCookie: [] }],
        querystring: Type.Object(
          {
            cursor: Type.Optional(Type.String({ maxLength: 1_024 })),
            limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
            search: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
            accountState: Type.Optional(
              Type.Union([Type.Literal("active"), Type.Literal("disabled"), Type.Literal("archived")]),
            ),
            mfaState: Type.Optional(
              Type.Union([
                Type.Literal("not_enrolled"),
                Type.Literal("enrollment_required"),
                Type.Literal("enrolled"),
                Type.Literal("recovery_required"),
              ]),
            ),
          },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({ items: Type.Array(UserSchema), page: PageSchema }),
          401: ErrorEnvelopeSchema,
          403: ErrorEnvelopeSchema,
          422: ErrorEnvelopeSchema,
        },
      },
    },
    async (request) => service.listUsers(await authenticated(request), request.query),
  );

  app.get<{ Params: Static<typeof UserParams> }>(
    "/internal/v1/admin/users/:userId",
    {
      schema: {
        operationId: "GetUser",
        tags: ["identity-admin"],
        security: [{ sessionCookie: [] }],
        params: UserParams,
        response: {
          200: UserSchema,
          401: ErrorEnvelopeSchema,
          403: ErrorEnvelopeSchema,
          404: ErrorEnvelopeSchema,
        },
      },
    },
    async (request) => service.getUser(await authenticated(request), request.params.userId),
  );

  app.post<{
    Params: Static<typeof UserParams>;
    Headers: Static<typeof CsrfHeaders>;
    Body: Static<typeof RolePreviewBody>;
  }>(
    ROLE_PREVIEW_OPERATION.path,
    {
      schema: {
        operationId: ROLE_PREVIEW_OPERATION.operationId,
        tags: ["identity-admin"],
        security: [{ sessionCookie: [], csrfToken: [] }],
        "x-permission-code": ROLE_PREVIEW_OPERATION.permissionCode,
        params: UserParams,
        headers: CsrfHeaders,
        body: RolePreviewBody,
        response: {
          200: EffectiveAccessPreviewSchema,
          401: ErrorEnvelopeSchema,
          403: ErrorEnvelopeSchema,
          404: ErrorEnvelopeSchema,
          409: ErrorEnvelopeSchema,
          422: ErrorEnvelopeSchema,
        },
      } as PermissionRouteSchema,
    },
    async (request) => {
      const context = await protectedContext(request);
      return service.previewEffectiveAccess(context, request.params.userId, request.body);
    },
  );

  for (const definition of ROLE_OPERATION_LIST) {
    const bodySchema = Type.Object(
      {
        ...(definition.roleFromBody ? { roleCode: Type.String({ minLength: 3, maxLength: 100 }) } : {}),
        ...RoleChangeCoreProperties,
        ...(definition.criticalApproval
          ? {
              approvalRequestId: Type.Optional(Type.String({ minLength: 20, maxLength: 96 })),
            }
          : {}),
        ...(definition.nominationRequired
          ? { nominationRef: Type.String({ minLength: 3, maxLength: 256 }) }
          : {}),
        ...(definition.transferRequired
          ? { transferRef: Type.String({ minLength: 3, maxLength: 256 }) }
          : {}),
      },
      { additionalProperties: false },
    );
    app.post<{
      Params: Static<typeof UserParams>;
      Headers: Static<typeof CsrfHeaders>;
      Body: RoleChangeInput;
    }>(
      definition.path,
      {
        schema: {
          operationId: definition.operationId,
          tags: ["identity-admin"],
          security: [{ sessionCookie: [], csrfToken: [] }],
          "x-permission-code": definition.permissionCode,
          params: UserParams,
          headers: CsrfHeaders,
          body: bodySchema,
          response: {
            200: AdminOperationSchema,
            202: AdminOperationSchema,
            401: ErrorEnvelopeSchema,
            403: ErrorEnvelopeSchema,
            404: ErrorEnvelopeSchema,
            409: ErrorEnvelopeSchema,
            422: ErrorEnvelopeSchema,
          },
        } as PermissionRouteSchema,
      },
      async (request, reply) => {
        const context = await protectedContext(request);
        const result = await service.changeRole(
          context,
          request.params.userId,
          definition.key,
          request.body,
          { requestId: request.id },
        );
        return reply.status(result.status === "approval_required" ? 202 : 200).send(result);
      },
    );
  }

  for (const route of [
    { action: "enable" as const, operationId: "EnableUser" },
    { action: "disable" as const, operationId: "DisableUser" },
    { action: "archive" as const, operationId: "ArchiveUser" },
  ]) {
    app.post<{
      Params: Static<typeof UserParams>;
      Headers: Static<typeof CsrfHeaders>;
      Body: Static<typeof VersionedReasonBody>;
    }>(
      `/internal/v1/admin/users/:userId/${route.action}`,
      {
        schema: {
          operationId: route.operationId,
          tags: ["identity-admin"],
          security: [{ sessionCookie: [], csrfToken: [] }],
          params: UserParams,
          headers: CsrfHeaders,
          body: VersionedReasonBody,
          response: {
            200: AdminOperationSchema,
            202: AdminOperationSchema,
            401: ErrorEnvelopeSchema,
            403: ErrorEnvelopeSchema,
            404: ErrorEnvelopeSchema,
            409: ErrorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const context = await protectedContext(request);
        const result = await service.transitionUser(
          context,
          request.params.userId,
          route.action,
          request.body,
          { requestId: request.id },
        );
        return reply.status(result.status === "approval_required" ? 202 : 200).send(result);
      },
    );
  }

  app.post<{
    Params: Static<typeof UserParams>;
    Headers: Static<typeof CsrfHeaders>;
    Body: Static<typeof ReasonBody>;
  }>(
    "/internal/v1/admin/users/:userId/password-reset",
    {
      schema: {
        operationId: "RequestAdminPasswordReset",
        tags: ["identity-admin"],
        security: [{ sessionCookie: [], csrfToken: [] }],
        params: UserParams,
        headers: CsrfHeaders,
        body: ReasonBody,
        response: {
          202: Type.Object({ expiresAt: DateTime }),
          401: ErrorEnvelopeSchema,
          403: ErrorEnvelopeSchema,
          404: ErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const context = await protectedContext(request);
      const result = await service.requestAdminPasswordReset(context, request.params.userId, request.body, {
        requestId: request.id,
      });
      return reply.status(202).send(result);
    },
  );

  app.post<{
    Params: Static<typeof UserParams>;
    Headers: Static<typeof CsrfHeaders>;
    Body: Static<typeof VersionedReasonBody>;
  }>(
    "/internal/v1/admin/users/:userId/mfa-reset",
    {
      schema: {
        operationId: "ResetUserMfa",
        tags: ["identity-admin"],
        security: [{ sessionCookie: [], csrfToken: [] }],
        params: UserParams,
        headers: CsrfHeaders,
        body: VersionedReasonBody,
        response: {
          200: AdminOperationSchema,
          202: AdminOperationSchema,
          401: ErrorEnvelopeSchema,
          403: ErrorEnvelopeSchema,
          404: ErrorEnvelopeSchema,
          409: ErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const context = await protectedContext(request);
      const result = await service.resetUserMfa(context, request.params.userId, request.body, {
        requestId: request.id,
      });
      return reply.status(result.status === "approval_required" ? 202 : 200).send(result);
    },
  );

  app.get<{
    Params: Static<typeof UserParams>;
    Querystring: Static<typeof AdminSessionListQuerySchema>;
  }>(
    IDENTITY_OPERATIONS["sessions.list_user"].path,
    {
      schema: {
        operationId: IDENTITY_OPERATIONS["sessions.list_user"].operationId,
        tags: ["identity-admin"],
        security: [{ sessionCookie: [] }],
        "x-permission-code": IDENTITY_OPERATIONS["sessions.list_user"].permissionCode,
        params: UserParams,
        querystring: AdminSessionListQuerySchema,
        response: {
          200: AdminSessionPageResponse,
          401: ErrorEnvelopeSchema,
          403: ErrorEnvelopeSchema,
          404: ErrorEnvelopeSchema,
          422: ErrorEnvelopeSchema,
        },
      } as PermissionRouteSchema,
    },
    async (request) =>
      service.listUserSessions(await authenticated(request), request.params.userId, request.query, {
        requestId: request.id,
      }),
  );

  app.post<{
    Params: Static<typeof UserParams>;
    Headers: Static<typeof CsrfHeaders>;
    Body: Static<typeof ReasonBody>;
  }>(
    "/internal/v1/admin/users/:userId/sessions/revoke",
    {
      schema: {
        operationId: "RevokeUserSessions",
        tags: ["identity-admin"],
        security: [{ sessionCookie: [], csrfToken: [] }],
        params: UserParams,
        headers: CsrfHeaders,
        body: ReasonBody,
        response: {
          200: Type.Object({ revokedCount: Type.Integer({ minimum: 0 }) }),
          401: ErrorEnvelopeSchema,
          403: ErrorEnvelopeSchema,
          404: ErrorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const context = await protectedContext(request);
      return service.revokeUserSessions(context, request.params.userId, request.body.reason, {
        requestId: request.id,
      });
    },
  );

  app.get<{
    Querystring: {
      cursor?: string;
      limit?: number;
      state?: "pending" | "approved" | "rejected" | "expired" | "executed" | "cancelled";
    };
  }>(
    "/internal/v1/admin/approval-requests",
    {
      schema: {
        operationId: "ListApprovalRequests",
        tags: ["identity-admin"],
        security: [{ sessionCookie: [] }],
        querystring: Type.Object(
          {
            cursor: Type.Optional(Type.String({ maxLength: 1_024 })),
            limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
            state: Type.Optional(
              Type.Union([
                Type.Literal("pending"),
                Type.Literal("approved"),
                Type.Literal("rejected"),
                Type.Literal("expired"),
                Type.Literal("executed"),
                Type.Literal("cancelled"),
              ]),
            ),
          },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({ items: Type.Array(ApprovalSchema), page: PageSchema }),
          401: ErrorEnvelopeSchema,
          403: ErrorEnvelopeSchema,
        },
      },
    },
    async (request) => service.listApprovals(await authenticated(request), request.query),
  );

  app.post<{
    Params: Static<typeof ApprovalParams>;
    Headers: Static<typeof CsrfHeaders>;
    Body: Static<typeof DecideApprovalBody>;
  }>(
    "/internal/v1/admin/approval-requests/:approvalId/decision",
    {
      schema: {
        operationId: "ApproveOrRejectCriticalOperation",
        tags: ["identity-admin"],
        security: [{ sessionCookie: [], csrfToken: [] }],
        params: ApprovalParams,
        headers: CsrfHeaders,
        body: DecideApprovalBody,
        response: {
          200: Type.Object({
            id: Type.String(),
            state: Type.Union([Type.Literal("approved"), Type.Literal("rejected")]),
            version: Type.Integer({ minimum: 1 }),
          }),
          401: ErrorEnvelopeSchema,
          403: ErrorEnvelopeSchema,
          404: ErrorEnvelopeSchema,
          409: ErrorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const context = await protectedContext(request);
      return service.decideApproval(context, request.params.approvalId, request.body, {
        requestId: request.id,
      });
    },
  );
};
