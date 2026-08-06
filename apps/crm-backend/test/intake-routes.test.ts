import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { UPLOAD_STORAGE_CEILING_BYTES } from "../src/common/upload-policy.js";
import { intakeRoutes } from "../src/modules/intake/routes.js";
import { createIntakeService } from "../src/modules/intake/service.js";
import {
  applicationPayload,
  applicationReceipt,
  canonicalApplicationPayload,
  FakeIntakeRepository,
  FakeIntakeStorage,
  multipartBody,
  pdfBytes,
} from "./intake-fixtures.js";

const apps: ReturnType<typeof Fastify>[] = [];

async function buildApp(
  options: {
    readonly swagger?: boolean;
    readonly setCookie?: boolean;
    readonly globalMultipart?: boolean;
    readonly globalRateLimit?: boolean;
    readonly applicationRateLimit?: number;
    readonly uploadMaxBytes?: number;
  } = {},
) {
  const uploadMaxBytes = options.uploadMaxBytes ?? UPLOAD_STORAGE_CEILING_BYTES;
  const repository = new FakeIntakeRepository();
  const storage = new FakeIntakeStorage();
  const service = createIntakeService({
    repository,
    storage,
    maxUploadBytes: uploadMaxBytes,
    now: () => new Date("2026-08-06T09:00:00.000Z"),
  });
  const app = Fastify({ logger: false });
  apps.push(app);
  if (options.setCookie) {
    app.addHook("onRequest", async (_request, reply) => {
      reply.header("set-cookie", "should-be-removed=1; HttpOnly");
    });
  }
  if (options.swagger) {
    await app.register(swagger, {
      openapi: { info: { title: "Intake test", version: "1.0.0" } },
    });
  }
  if (options.globalMultipart) {
    await app.register(multipart, { limits: { files: 1, fileSize: uploadMaxBytes } });
  }
  if (options.globalRateLimit) {
    await app.register(rateLimit, { global: false, keyGenerator: (request) => request.ip });
  }
  await app.register(intakeRoutes, {
    service,
    uploadMaxBytes,
    aliases: true,
    allowedOrigins: ["https://landing.example"],
    ...(options.applicationRateLimit ? { rateLimit: { applicationMax: options.applicationRateLimit } } : {}),
  });
  await app.ready();
  return { app, repository, storage };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("public intake routes", () => {
  it("serves canonical and compatibility read routes with cursor metadata", async () => {
    const { app, repository } = await buildApp();
    const spheres = await app.inject({ method: "GET", url: "/public/v1/dictionaries/spheres" });
    const mapPoints = await app.inject({ method: "GET", url: "/api/v1/map-points" });
    const vacancies = await app.inject({
      method: "GET",
      url: "/public/v1/vacancies?sector=medicine&limit=5",
    });

    expect(spheres.statusCode).toBe(200);
    expect(spheres.json()).toMatchObject({ items: [{ value: "medicine" }] });
    expect(mapPoints.statusCode).toBe(200);
    expect(mapPoints.json()).toMatchObject({ items: [{ id: "murmansk" }] });
    expect(vacancies.statusCode).toBe(200);
    expect(vacancies.json()).toMatchObject({
      items: [{ id: "vac_medicine_01" }],
      page: { limit: 5, nextCursor: "cursor_next", hasMore: true },
    });
    expect(repository.vacancyQueries[0]).toEqual({ sector: "medicine", cursor: null, limit: 5 });
  });

  it("requires Idempotency-Key and always returns the JSON error contract", async () => {
    const { app } = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/public/v1/applications",
      payload: canonicalApplicationPayload,
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      code: "validation_error",
      message: "Validation failed",
      requestId: expect.any(String),
      errors: expect.arrayContaining([
        expect.objectContaining({ field: expect.stringContaining("idempotency-key") }),
      ]),
    });
    expect(response.headers["x-request-id"]).toBe(response.json().requestId);
  });

  it("rejects page limits above the documented maximum", async () => {
    const { app, repository } = await buildApp();
    const response = await app.inject({ method: "GET", url: "/public/v1/vacancies?limit=101" });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: "validation_error" });
    expect(repository.vacancyQueries).toHaveLength(0);
  });

  it("submits through the canonical route and marks idempotent replays", async () => {
    const { app, repository } = await buildApp();
    repository.applicationResult = { state: "replayed", value: applicationReceipt };
    const response = await app.inject({
      method: "POST",
      url: "/public/v1/applications",
      headers: { "idempotency-key": "application-key-01" },
      payload: canonicalApplicationPayload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["idempotency-replayed"]).toBe("true");
    expect(response.json()).toEqual(applicationReceipt);
  });

  it("requires versioned consent evidence on canonical intake and keeps it only as legacy compatibility", async () => {
    const { app, repository } = await buildApp();
    const canonical = await app.inject({
      method: "POST",
      url: "/public/v1/applications",
      headers: { "idempotency-key": "canonical-consent-key-01" },
      payload: applicationPayload,
    });
    const legacy = await app.inject({
      method: "POST",
      url: "/api/v1/applications",
      headers: { "idempotency-key": "legacy-consent-key-01" },
      payload: applicationPayload,
    });

    expect(canonical.statusCode).toBe(422);
    expect(canonical.json()).toMatchObject({
      code: "validation_error",
      errors: expect.arrayContaining([
        expect.objectContaining({ field: "consents.privacyPolicyVersion", code: "required" }),
        expect.objectContaining({ field: "consents.acceptedAt", code: "required" }),
      ]),
    });
    expect(legacy.statusCode).toBe(201);
    expect(repository.applicationCommands).toHaveLength(1);
    expect(repository.applicationCommands[0]?.input.consent.evidence).toBe("server-received-compat");
  });

  it("requires an upload binding only on the canonical application contract", async () => {
    const { app, repository } = await buildApp();
    const withoutBinding = {
      ...canonicalApplicationPayload,
      attachments: { resumeFileId: "file_resume_01" },
    };
    const canonical = await app.inject({
      method: "POST",
      url: "/public/v1/applications",
      headers: { "idempotency-key": "canonical-binding-key-01" },
      payload: withoutBinding,
    });
    const legacy = await app.inject({
      method: "POST",
      url: "/api/v1/applications",
      headers: { "idempotency-key": "legacy-binding-key-01" },
      payload: withoutBinding,
    });

    expect(canonical.statusCode).toBe(422);
    expect(canonical.json()).toMatchObject({
      code: "validation_error",
      errors: expect.arrayContaining([
        expect.objectContaining({ field: "attachments.resumeFileBindingToken" }),
      ]),
    });
    expect(legacy.statusCode).toBe(201);
    expect(repository.applicationCommands).toHaveLength(1);
    expect(repository.applicationCommands[0]?.requireUploadBinding).toBe(false);
  });

  it("enforces the configured application rate limit with the JSON error contract", async () => {
    const { app } = await buildApp({ globalRateLimit: true, applicationRateLimit: 1 });
    const first = await app.inject({
      method: "POST",
      url: "/public/v1/applications",
      headers: { "idempotency-key": "application-rate-01" },
      payload: canonicalApplicationPayload,
    });
    const second = await app.inject({
      method: "POST",
      url: "/public/v1/applications",
      headers: { "idempotency-key": "application-rate-02" },
      payload: canonicalApplicationPayload,
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(429);
    expect(second.json()).toMatchObject({
      code: "rate_limit_exceeded",
      requestId: expect.any(String),
      errors: [],
    });
  });

  it("rejects mixed relocation/student payloads with a field-level error", async () => {
    const { app } = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/applications",
      headers: { "idempotency-key": "application-key-01" },
      payload: {
        ...applicationPayload,
        application: {
          ...applicationPayload.application,
          studentProfile: {
            institution: "МАГУ",
            specialty: "Лечебное дело",
            graduationYear: 2027,
            status: "3",
          },
        },
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: "validation_error",
      errors: [
        {
          field: "application.studentProfile",
          code: "forbidden_for_applicant_type",
        },
      ],
    });
  });

  it("accepts multipart upload on /uploads and the landing-compatible /files alias", async () => {
    const { app, storage } = await buildApp();
    const bytes = pdfBytes();
    for (const url of ["/public/v1/uploads", "/api/v1/files"] as const) {
      const boundary = `intake-boundary-${url.length}`;
      const response = await app.inject({
        method: "POST",
        url,
        headers: {
          "content-type": `multipart/form-data; boundary=${boundary}`,
          "idempotency-key": `upload-key-${url.length}`,
        },
        payload: multipartBody(boundary, "resume.pdf", "application/pdf", bytes),
      });
      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({ fileId: "file_resume_01", status: "quarantined" });
    }
    expect(storage.commands).toHaveLength(2);
  });

  it("reuses a multipart parser already registered by the root app", async () => {
    const { app, storage } = await buildApp({ globalMultipart: true });
    const boundary = "intake-global-multipart";
    const response = await app.inject({
      method: "POST",
      url: "/public/v1/uploads",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "idempotency-key": "upload-global-key-01",
      },
      payload: multipartBody(boundary, "resume.pdf", "application/pdf", pdfBytes()),
    });

    expect(response.statusCode).toBe(201);
    expect(storage.commands).toHaveLength(1);
  });

  it("enforces the injected runtime upload limit before storage", async () => {
    const bytes = pdfBytes();
    const { app, storage } = await buildApp({ uploadMaxBytes: bytes.byteLength - 1 });
    const boundary = "intake-configured-upload-limit";
    const response = await app.inject({
      method: "POST",
      url: "/public/v1/uploads",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "idempotency-key": "upload-configured-limit-01",
      },
      payload: multipartBody(boundary, "resume.pdf", "application/pdf", bytes),
    });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({ code: "payload_too_large" });
    expect(storage.commands).toHaveLength(0);
  });

  it("rejects a foreign Origin and never emits Set-Cookie", async () => {
    const { app } = await buildApp({ setCookie: true });
    const forbidden = await app.inject({
      method: "GET",
      url: "/public/v1/map-points",
      headers: { origin: "https://evil.example", cookie: "session=ignored" },
    });
    const accepted = await app.inject({
      method: "GET",
      url: "/public/v1/map-points",
      headers: { origin: "https://landing.example", cookie: "session=ignored" },
    });

    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toMatchObject({ code: "origin_not_allowed", errors: [] });
    expect(forbidden.headers["set-cookie"]).toBeUndefined();
    expect(accepted.statusCode).toBe(200);
    expect(accepted.headers["set-cookie"]).toBeUndefined();
  });

  it("publishes canonical schemas and deprecated aliases in OpenAPI", async () => {
    const { app } = await buildApp({ swagger: true });
    const document = app.swagger();

    expect(document.paths?.["/public/v1/vacancies"]?.get).toMatchObject({
      operationId: "publicListVacancies",
      security: [],
    });
    expect(document.paths?.["/public/v1/vacancies"]?.get?.deprecated).not.toBe(true);
    expect(document.paths?.["/api/v1/applications"]?.post).toMatchObject({
      operationId: "LegacyCreateApplication",
      security: [],
      deprecated: true,
    });
    expect(document.paths?.["/public/v1/applications"]?.post).toMatchObject({
      operationId: "CreateApplication",
    });
    expect(document.paths?.["/public/v1/applications"]?.post?.deprecated).not.toBe(true);
    expect(document.paths?.["/public/v1/applications"]?.post?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ in: "header", name: "idempotency-key", required: true }),
      ]),
    );
    const canonicalApplicationContract = JSON.stringify(document.paths?.["/public/v1/applications"]?.post);
    expect(canonicalApplicationContract).toContain(
      '"required":["privacyAccepted","privacyPolicyVersion","acceptedAt"]',
    );
    expect(canonicalApplicationContract).toContain('"required":["resumeFileId","resumeFileBindingToken"]');
    expect(JSON.stringify(document.paths?.["/public/v1/uploads"]?.post)).toContain("multipart/form-data");
  });
});
