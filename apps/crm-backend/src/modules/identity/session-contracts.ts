import { type Static, Type } from "@sinclair/typebox";

const DateTime = Type.String({ format: "date-time" });

export const SessionListQueryProperties = {
  cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 1_024 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
} as const;

export const SessionListQuerySchema = Type.Object(SessionListQueryProperties, {
  additionalProperties: false,
});

export const SessionPageMetadataSchema = Type.Object(
  {
    limit: Type.Integer({ minimum: 1, maximum: 200 }),
    nextCursor: Type.Union([Type.String({ minLength: 1, maxLength: 1_024 }), Type.Null()]),
    hasMore: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const OwnSessionItemSchema = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    authenticationLevel: Type.Union([
      Type.Literal("password"),
      Type.Literal("mfa"),
      Type.Literal("fresh_mfa"),
    ]),
    createdAt: DateTime,
    lastSeenAt: DateTime,
    absoluteExpiresAt: DateTime,
    revokedAt: Type.Union([DateTime, Type.Null()]),
  },
  { additionalProperties: false },
);

export const AdminSessionItemSchema = Type.Composite(
  [
    OwnSessionItemSchema,
    Type.Object({ ipPrefix: Type.Union([Type.String(), Type.Null()]) }, { additionalProperties: false }),
  ],
  { additionalProperties: false },
);

export type SessionListQuery = Static<typeof SessionListQuerySchema>;
export type IdentitySessionItem = Static<typeof OwnSessionItemSchema>;
export type AdminIdentitySessionItem = Static<typeof AdminSessionItemSchema>;
