import { z } from "zod";
import { UPLOAD_STORAGE_CEILING_BYTES } from "../common/upload-policy.js";

const booleanFromString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const DEVELOPMENT_DATABASE_URL = "postgresql://kurs_crm:kurs_crm@127.0.0.1:5432/kurs_crm";
const DEVELOPMENT_CURSOR_SIGNING_KEY = "development-only-cursor-signing-key-change-me";
const DEVELOPMENT_SESSION_TOKEN_PEPPER = "development-only-session-token-pepper-change-me";
const DEVELOPMENT_PII_HASHING_KEY = "development-only-pii-hashing-key-change-me";
const DEVELOPMENT_CREDENTIAL_TOKEN_SECRET = "development-only-credential-token-secret-change-me";

function isUnsafeProductionSecret(value: string, developmentDefault: string): boolean {
  return (
    value.length < 32 ||
    value === developmentDefault ||
    /(?:development-only|replace-with|change[-_ ]?me|changeme)/iu.test(value)
  );
}

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    HOST: z.string().min(1).default("0.0.0.0"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    DATABASE_URL: z.string().min(1).default(DEVELOPMENT_DATABASE_URL),
    PUBLIC_ORIGINS: z.string().default("http://localhost:8105,https://cursnasever.facex.pro"),
    TRUST_PROXY: booleanFromString,
    CURSOR_SIGNING_KEY: z.string().default(DEVELOPMENT_CURSOR_SIGNING_KEY),
    SESSION_COOKIE_NAME: z.string().min(1).default("kns_crm_session"),
    SESSION_TOKEN_PEPPER: z.string().default(DEVELOPMENT_SESSION_TOKEN_PEPPER),
    CREDENTIAL_DELIVERY_TOKEN_SECRET: z.string().default(DEVELOPMENT_CREDENTIAL_TOKEN_SECRET),
    SESSION_IDLE_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
    SESSION_ABSOLUTE_TTL_SECONDS: z.coerce.number().int().positive().default(43_200),
    MFA_ENCRYPTION_KEY_BASE64: z.string().default(""),
    PII_HASHING_KEY: z.string().default(DEVELOPMENT_PII_HASHING_KEY),
    PUBLIC_CONTENT_ROOT: z.string().min(1).default("../../assets/data"),
    IDEMPOTENCY_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
    OUTBOX_WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(25),
    OUTBOX_WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
    OUTBOX_WORKER_LOCK_TTL_SECONDS: z.coerce.number().int().min(30).max(3_600).default(300),
    UPLOAD_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .max(UPLOAD_STORAGE_CEILING_BYTES)
      .default(UPLOAD_STORAGE_CEILING_BYTES),
    OBJECT_STORAGE_DRIVER: z.enum(["filesystem", "s3", "memory"]).default("filesystem"),
    OBJECT_STORAGE_PATH: z.string().min(1).default("./var/uploads"),
    S3_ENDPOINT: z.string().url().default("http://127.0.0.1:9000"),
    S3_REGION: z.string().min(1).default("ru-1"),
    S3_BUCKET: z.string().min(1).default("kurs-na-sever-crm"),
    S3_ACCESS_KEY_ID: z.string().default(""),
    S3_SECRET_ACCESS_KEY: z.string().default(""),
    LEGACY_MYSQL_URL: z.string().default(""),
    LEGACY_DUMP_SHA256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .default("7d38354b78f7c30423462799f088f097cd129eb3934b4e29b3664b0f648e79bf"),
    MIGRATION_ALLOW_PARTIAL: booleanFromString,
    MIGRATION_WRITE_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(10),
  })
  .superRefine((value, context) => {
    if (
      value.NODE_ENV === "production" &&
      isUnsafeProductionSecret(value.CURSOR_SIGNING_KEY, DEVELOPMENT_CURSOR_SIGNING_KEY)
    ) {
      context.addIssue({
        code: "custom",
        path: ["CURSOR_SIGNING_KEY"],
        message: "CURSOR_SIGNING_KEY must be a non-placeholder secret in production",
      });
    }

    for (const [key, developmentDefault] of [
      ["SESSION_TOKEN_PEPPER", DEVELOPMENT_SESSION_TOKEN_PEPPER],
      ["PII_HASHING_KEY", DEVELOPMENT_PII_HASHING_KEY],
      ["CREDENTIAL_DELIVERY_TOKEN_SECRET", DEVELOPMENT_CREDENTIAL_TOKEN_SECRET],
    ] as const) {
      if (value.NODE_ENV === "production" && isUnsafeProductionSecret(value[key], developmentDefault)) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: `${key} must be a non-placeholder secret in production`,
        });
      }
    }

    if (value.NODE_ENV === "production") {
      if (value.DATABASE_URL === DEVELOPMENT_DATABASE_URL) {
        context.addIssue({
          code: "custom",
          path: ["DATABASE_URL"],
          message: "DATABASE_URL must be configured explicitly in production",
        });
      }

      const decodedLength = Buffer.from(value.MFA_ENCRYPTION_KEY_BASE64, "base64").length;
      if (decodedLength !== 32) {
        context.addIssue({
          code: "custom",
          path: ["MFA_ENCRYPTION_KEY_BASE64"],
          message: "MFA_ENCRYPTION_KEY_BASE64 must decode to exactly 32 bytes in production",
        });
      }
    }

    if (value.NODE_ENV === "production" && value.OBJECT_STORAGE_DRIVER === "memory") {
      context.addIssue({
        code: "custom",
        path: ["OBJECT_STORAGE_DRIVER"],
        message: "OBJECT_STORAGE_DRIVER=memory is forbidden in production",
      });
    }

    if (
      value.NODE_ENV === "production" &&
      value.OBJECT_STORAGE_DRIVER === "s3" &&
      (!value.S3_ACCESS_KEY_ID || !value.S3_SECRET_ACCESS_KEY)
    ) {
      context.addIssue({
        code: "custom",
        path: ["S3_ACCESS_KEY_ID"],
        message: "S3 credentials are required when OBJECT_STORAGE_DRIVER=s3",
      });
    }

    if (
      value.NODE_ENV === "production" &&
      value.OBJECT_STORAGE_DRIVER === "s3" &&
      new URL(value.S3_ENDPOINT).protocol !== "https:"
    ) {
      context.addIssue({
        code: "custom",
        path: ["S3_ENDPOINT"],
        message: "S3_ENDPOINT must use HTTPS in production",
      });
    }
  });

const databaseEnvironmentSchema = z.object({
  DATABASE_URL: z.string().min(1),
});

const workerEnvironmentSchema = databaseEnvironmentSchema.extend({
  OUTBOX_WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(25),
  OUTBOX_WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
  OUTBOX_WORKER_LOCK_TTL_SECONDS: z.coerce.number().int().min(30).max(3_600).default(300),
});

const credentialWorkerEnvironmentSchema = databaseEnvironmentSchema
  .extend({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    CREDENTIAL_DELIVERY_PROVIDER_URL: z.string().min(1).url(),
    CREDENTIAL_DELIVERY_SIGNING_SECRET: z.string().min(32),
    CREDENTIAL_DELIVERY_TOKEN_SECRET: z.string().min(32),
    CREDENTIAL_DELIVERY_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(5_000),
    CREDENTIAL_DELIVERY_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(10),
    CREDENTIAL_DELIVERY_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
    CREDENTIAL_DELIVERY_LOCK_TTL_SECONDS: z.coerce.number().int().min(30).max(3_600).default(300),
    CREDENTIAL_DELIVERY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(6),
    CREDENTIAL_DELIVERY_BASE_BACKOFF_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(5_000),
    CREDENTIAL_DELIVERY_MAX_BACKOFF_MS: z.coerce.number().int().min(1_000).max(86_400_000).default(900_000),
  })
  .superRefine((value, context) => {
    if (URL.canParse(value.CREDENTIAL_DELIVERY_PROVIDER_URL)) {
      const providerUrl = new URL(value.CREDENTIAL_DELIVERY_PROVIDER_URL);
      if (providerUrl.protocol !== "https:") {
        context.addIssue({
          code: "custom",
          path: ["CREDENTIAL_DELIVERY_PROVIDER_URL"],
          message: "CREDENTIAL_DELIVERY_PROVIDER_URL must use HTTPS",
        });
      }
      if (providerUrl.username || providerUrl.password || providerUrl.hash) {
        context.addIssue({
          code: "custom",
          path: ["CREDENTIAL_DELIVERY_PROVIDER_URL"],
          message: "CREDENTIAL_DELIVERY_PROVIDER_URL must not contain credentials or a fragment",
        });
      }
    }
    if (value.CREDENTIAL_DELIVERY_SIGNING_SECRET === value.CREDENTIAL_DELIVERY_TOKEN_SECRET) {
      context.addIssue({
        code: "custom",
        path: ["CREDENTIAL_DELIVERY_TOKEN_SECRET"],
        message: "credential token and webhook signing secrets must be different",
      });
    }
    if (value.CREDENTIAL_DELIVERY_MAX_BACKOFF_MS < value.CREDENTIAL_DELIVERY_BASE_BACKOFF_MS) {
      context.addIssue({
        code: "custom",
        path: ["CREDENTIAL_DELIVERY_MAX_BACKOFF_MS"],
        message: "maximum backoff must not be smaller than base backoff",
      });
    }
    if (
      value.NODE_ENV === "production" &&
      isUnsafeProductionSecret(value.CREDENTIAL_DELIVERY_TOKEN_SECRET, DEVELOPMENT_CREDENTIAL_TOKEN_SECRET)
    ) {
      context.addIssue({
        code: "custom",
        path: ["CREDENTIAL_DELIVERY_TOKEN_SECRET"],
        message: "CREDENTIAL_DELIVERY_TOKEN_SECRET must be a non-placeholder secret in production",
      });
    }
    if (
      value.NODE_ENV === "production" &&
      /(?:development-only|replace-with|change[-_ ]?me|changeme)/iu.test(
        value.CREDENTIAL_DELIVERY_SIGNING_SECRET,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["CREDENTIAL_DELIVERY_SIGNING_SECRET"],
        message: "CREDENTIAL_DELIVERY_SIGNING_SECRET must be a non-placeholder secret in production",
      });
    }
  });

export type AppConfig = ReturnType<typeof loadConfig>;
export type DatabaseRuntimeConfig = ReturnType<typeof loadDatabaseRuntimeConfig>;
export type WorkerRuntimeConfig = ReturnType<typeof loadWorkerRuntimeConfig>;
export type CredentialWorkerRuntimeConfig = ReturnType<typeof loadCredentialWorkerRuntimeConfig>;

export function loadDatabaseRuntimeConfig(source: NodeJS.ProcessEnv = process.env) {
  const value = databaseEnvironmentSchema.parse(source);
  return { databaseUrl: value.DATABASE_URL };
}

export function loadWorkerRuntimeConfig(source: NodeJS.ProcessEnv = process.env) {
  const value = workerEnvironmentSchema.parse(source);
  return {
    databaseUrl: value.DATABASE_URL,
    worker: {
      batchSize: value.OUTBOX_WORKER_BATCH_SIZE,
      pollIntervalMs: value.OUTBOX_WORKER_POLL_INTERVAL_MS,
      lockTtlSeconds: value.OUTBOX_WORKER_LOCK_TTL_SECONDS,
    },
  };
}

export function loadCredentialWorkerRuntimeConfig(source: NodeJS.ProcessEnv = process.env) {
  const value = credentialWorkerEnvironmentSchema.parse(source);
  return {
    nodeEnv: value.NODE_ENV,
    databaseUrl: value.DATABASE_URL,
    worker: {
      batchSize: value.CREDENTIAL_DELIVERY_BATCH_SIZE,
      pollIntervalMs: value.CREDENTIAL_DELIVERY_POLL_INTERVAL_MS,
      lockTtlSeconds: value.CREDENTIAL_DELIVERY_LOCK_TTL_SECONDS,
      maxAttempts: value.CREDENTIAL_DELIVERY_MAX_ATTEMPTS,
      baseBackoffMs: value.CREDENTIAL_DELIVERY_BASE_BACKOFF_MS,
      maxBackoffMs: value.CREDENTIAL_DELIVERY_MAX_BACKOFF_MS,
    },
    credentialDelivery: {
      providerUrl: value.CREDENTIAL_DELIVERY_PROVIDER_URL,
      signingSecret: value.CREDENTIAL_DELIVERY_SIGNING_SECRET,
      tokenSecret: value.CREDENTIAL_DELIVERY_TOKEN_SECRET,
      requestTimeoutMs: value.CREDENTIAL_DELIVERY_REQUEST_TIMEOUT_MS,
    },
  };
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env) {
  const value = environmentSchema.parse(source);

  return {
    nodeEnv: value.NODE_ENV,
    host: value.HOST,
    port: value.PORT,
    logLevel: value.LOG_LEVEL,
    databaseUrl: value.DATABASE_URL,
    publicOrigins: value.PUBLIC_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    trustProxy: value.TRUST_PROXY,
    cursorSigningKey: value.CURSOR_SIGNING_KEY,
    session: {
      cookieName: value.SESSION_COOKIE_NAME,
      tokenPepper: value.SESSION_TOKEN_PEPPER,
      idleTtlSeconds: value.SESSION_IDLE_TTL_SECONDS,
      absoluteTtlSeconds: value.SESSION_ABSOLUTE_TTL_SECONDS,
    },
    credentialDelivery: {
      tokenSecret: value.CREDENTIAL_DELIVERY_TOKEN_SECRET,
    },
    mfaEncryptionKeyBase64: value.MFA_ENCRYPTION_KEY_BASE64,
    piiHashingKey: value.PII_HASHING_KEY,
    publicContentRoot: value.PUBLIC_CONTENT_ROOT,
    idempotencyTtlSeconds: value.IDEMPOTENCY_TTL_SECONDS,
    worker: {
      batchSize: value.OUTBOX_WORKER_BATCH_SIZE,
      pollIntervalMs: value.OUTBOX_WORKER_POLL_INTERVAL_MS,
      lockTtlSeconds: value.OUTBOX_WORKER_LOCK_TTL_SECONDS,
    },
    uploads: {
      maxBytes: value.UPLOAD_MAX_BYTES,
      driver: value.OBJECT_STORAGE_DRIVER,
      filesystemPath: value.OBJECT_STORAGE_PATH,
      s3: {
        endpoint: value.S3_ENDPOINT,
        region: value.S3_REGION,
        bucket: value.S3_BUCKET,
        accessKeyId: value.S3_ACCESS_KEY_ID,
        secretAccessKey: value.S3_SECRET_ACCESS_KEY,
      },
    },
    migration: {
      legacyMysqlUrl: value.LEGACY_MYSQL_URL,
      expectedDumpSha256: value.LEGACY_DUMP_SHA256,
      allowPartial: value.MIGRATION_ALLOW_PARTIAL,
      writeConcurrency: value.MIGRATION_WRITE_CONCURRENCY,
      sourceSystem: "bitrix" as const,
    },
  };
}
