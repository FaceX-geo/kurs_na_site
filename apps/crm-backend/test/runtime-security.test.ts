import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { UPLOAD_STORAGE_CEILING_BYTES } from "../src/common/upload-policy.js";
import {
  loadConfig,
  loadCredentialWorkerRuntimeConfig,
  loadDatabaseRuntimeConfig,
  loadWorkerRuntimeConfig,
} from "../src/config/env.js";
import { createObjectStore } from "../src/modules/intake/object-storage.js";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryDirectories: string[] = [];

function productionEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://kurs_crm_api:strongvalue@postgres:5432/kurs_crm",
    CURSOR_SIGNING_KEY: "9QfN4zHp3sV8mJ6rT2xK7cWd5gBy1uEa",
    SESSION_TOKEN_PEPPER: "6gPk3Zs1Nw8Jx4Vr9Ym2Qd7Ht5Lc0FaE",
    CREDENTIAL_DELIVERY_TOKEN_SECRET: "8uLd2Gc9Qm4Hx7Vs1Za5Wn0Jp6Tf3RyK",
    MFA_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 7).toString("base64"),
    PII_HASHING_KEY: "4nVa8Xq2Cf7Ls5Dw1Jm9Rp6Uk3Hz0YeB",
    OBJECT_STORAGE_DRIVER: "filesystem",
    OBJECT_STORAGE_PATH: "/data/quarantine",
    PUBLIC_ORIGINS: "https://cursnasever.facex.pro",
    TRUST_PROXY: "true",
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("production runtime configuration", () => {
  it("accepts an explicit non-placeholder filesystem configuration", () => {
    expect(loadConfig(productionEnvironment()).nodeEnv).toBe("production");
  });

  it("allows the MFA bypass only in an explicit test runtime", () => {
    expect(loadConfig({ NODE_ENV: "test", CRM_TEST_AUTH_BYPASS: "true" }).auth.testMfaBypass).toBe(true);
    expect(() => loadConfig(productionEnvironment({ CRM_TEST_AUTH_BYPASS: "true" }))).toThrow(
      /allowed only when NODE_ENV=test/u,
    );
  });

  it("rejects a runtime upload limit above the durable storage ceiling", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        UPLOAD_MAX_BYTES: String(UPLOAD_STORAGE_CEILING_BYTES + 1),
      }),
    ).toThrow();
  });

  it("rejects development secret defaults in production", () => {
    const environment = productionEnvironment();
    delete environment.CURSOR_SIGNING_KEY;
    delete environment.SESSION_TOKEN_PEPPER;
    delete environment.PII_HASHING_KEY;
    delete environment.CREDENTIAL_DELIVERY_TOKEN_SECRET;
    expect(() => loadConfig(environment)).toThrow(/non-placeholder secret/u);
  });

  it("rejects memory storage and plaintext S3 in production", () => {
    expect(() => loadConfig(productionEnvironment({ OBJECT_STORAGE_DRIVER: "memory" }))).toThrow(
      /forbidden in production/u,
    );
    expect(() =>
      loadConfig(
        productionEnvironment({
          OBJECT_STORAGE_DRIVER: "s3",
          S3_ENDPOINT: "http://minio:9000",
          S3_ACCESS_KEY_ID: "runtime-access",
          S3_SECRET_ACCESS_KEY: "runtime-secret",
        }),
      ),
    ).toThrow(/must use HTTPS/u);
  });

  it("keeps worker and migrator configuration free of API secrets", () => {
    const source = { DATABASE_URL: "postgresql://runtime@postgres/kurs_crm" };
    expect(loadDatabaseRuntimeConfig(source)).toEqual({ databaseUrl: source.DATABASE_URL });
    expect(loadWorkerRuntimeConfig(source)).toMatchObject({
      databaseUrl: source.DATABASE_URL,
      worker: { batchSize: 25, pollIntervalMs: 1_000, lockTtlSeconds: 300 },
    });
  });

  it("fails credential delivery closed without an HTTPS provider and distinct secrets", () => {
    const valid = {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://credential-worker@postgres/kurs_crm",
      CREDENTIAL_DELIVERY_PROVIDER_URL: "https://delivery.example.test/hooks/credentials",
      CREDENTIAL_DELIVERY_SIGNING_SECRET: "4oJd7Lm2Qp9Xv6Ws3Ca8Fn1Hz5Rt0UyK",
      CREDENTIAL_DELIVERY_TOKEN_SECRET: "8uLd2Gc9Qm4Hx7Vs1Za5Wn0Jp6Tf3RyK",
    };
    expect(loadCredentialWorkerRuntimeConfig(valid)).toMatchObject({
      nodeEnv: "production",
      credentialDelivery: { requestTimeoutMs: 5_000 },
      worker: { maxAttempts: 6, baseBackoffMs: 5_000, maxBackoffMs: 900_000 },
    });
    expect(() =>
      loadCredentialWorkerRuntimeConfig({
        ...valid,
        CREDENTIAL_DELIVERY_PROVIDER_URL: "http://delivery.example.test/hooks/credentials",
      }),
    ).toThrow(/must use HTTPS/u);
    const missingProvider = { ...valid };
    delete (missingProvider as Partial<typeof valid>).CREDENTIAL_DELIVERY_PROVIDER_URL;
    expect(() => loadCredentialWorkerRuntimeConfig(missingProvider)).toThrow();
    expect(() =>
      loadCredentialWorkerRuntimeConfig({
        ...valid,
        CREDENTIAL_DELIVERY_SIGNING_SECRET: valid.CREDENTIAL_DELIVERY_TOKEN_SECRET,
      }),
    ).toThrow(/must be different/u);
  });
});

describe("runtime edge and storage contracts", () => {
  it("preserves only a validated edge request id", async () => {
    const app = await buildApp(loadConfig({ NODE_ENV: "test" }));
    try {
      const trusted = await app.inject({
        method: "GET",
        url: "/health/live",
        headers: { "x-request-id": "edge-0123456789abcdef" },
      });
      expect(trusted.headers["x-request-id"]).toBe("edge-0123456789abcdef");

      const rejected = await app.inject({
        method: "GET",
        url: "/health/live",
        headers: { "x-request-id": "bad" },
      });
      expect(rejected.headers["x-request-id"]).toMatch(/^req_/u);
    } finally {
      await app.close();
    }
  });

  it("prevents shared caches from storing authenticated API responses", async () => {
    const app = await buildApp(loadConfig({ NODE_ENV: "test" }), {
      registerRoutes: async (instance) => {
        instance.get("/internal/v1/security-probe", async () => ({ ok: true }));
      },
    });
    try {
      const response = await app.inject({ method: "GET", url: "/internal/v1/security-probe" });
      expect(response.headers["cache-control"]).toBe("no-store, private");
      expect(response.headers.pragma).toBe("no-cache");
    } finally {
      await app.close();
    }
  });

  it("proves filesystem readiness with a write/delete probe", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "kns-storage-readiness-"));
    temporaryDirectories.push(directory);
    const config = loadConfig({
      NODE_ENV: "test",
      OBJECT_STORAGE_DRIVER: "filesystem",
      OBJECT_STORAGE_PATH: directory,
    });
    await createObjectStore(config).ping();
    expect(await readdir(path.join(directory, ".readiness"))).toEqual([]);
  });

  it("keeps deployment wiring fail-closed", async () => {
    const [compose, nginx] = await Promise.all([
      readFile(path.join(appRoot, "compose.yaml"), "utf8"),
      readFile(path.join(appRoot, "deploy/nginx-crm-locations.conf"), "utf8"),
    ]);
    expect(compose).toContain("postgresql://kurs_crm_api:");
    expect(compose).toContain("postgresql://kurs_crm_worker:");
    expect(compose).toContain("postgresql://kurs_crm_credential_worker:");
    expect(compose).toContain("postgresql://kurs_crm_migrator:");
    expect(compose).toContain('command: ["node", "dist/credential-worker.js"]');
    expect(compose).toContain("profiles: [credential-delivery]");
    expect(compose).toContain("http://127.0.0.1:8080/health/ready");
    expect(compose).toMatch(/edge:\n\s+external: true/u);
    expect(nginx).toContain("X-Forwarded-For $remote_addr");
    expect(nginx).not.toContain("$proxy_add_x_forwarded_for");
  });
});
