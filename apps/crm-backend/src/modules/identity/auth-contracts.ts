import { type Static, Type } from "@sinclair/typebox";

export const BusinessRoleSchema = Type.Union([Type.Literal("SUPER_ADMIN"), Type.Literal("SPECIALIST")]);

export const AuthenticatedUserSchema = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    email: Type.String({ format: "email" }),
    displayName: Type.String(),
    roles: Type.Array(Type.String()),
    permissions: Type.Array(Type.String()),
    businessRole: Type.Union([BusinessRoleSchema, Type.Null()]),
    employeeProfileId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
  },
  { additionalProperties: false },
);

export const AuthenticatedSessionReceiptSchema = Type.Object(
  {
    status: Type.Literal("authenticated"),
    csrfToken: Type.String(),
    expiresAt: Type.String({ format: "date-time" }),
    user: AuthenticatedUserSchema,
  },
  { additionalProperties: false },
);

export const OwnProfileSchema = Type.Object(
  {
    userAccountId: Type.String({ format: "uuid" }),
    email: Type.String({ format: "email" }),
    authenticationLevel: Type.Union([
      Type.Literal("password"),
      Type.Literal("mfa"),
      Type.Literal("fresh_mfa"),
    ]),
    roles: Type.Array(Type.String()),
    permissions: Type.Array(Type.String()),
    businessRole: Type.Union([BusinessRoleSchema, Type.Null()]),
    employeeProfileId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
  },
  { additionalProperties: false },
);

export const CsrfRefreshReceiptSchema = Type.Object(
  {
    csrfToken: Type.String({ minLength: 43, maxLength: 128 }),
  },
  { additionalProperties: false },
);

export type CsrfRefreshReceipt = Static<typeof CsrfRefreshReceiptSchema>;
