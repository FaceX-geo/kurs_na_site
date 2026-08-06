import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import ApiClient, {
  ApiError,
  bindSubmitAttemptPayload,
  createSubmitAttempt,
  createSubmitAttemptKeys,
} from "../scripts/api-client.js";
import {
  VACANCY_SECTORS,
  calculateAgeOn,
  digitsOnly,
  isVacancyRouteCompatible,
  minimumAgeFor,
  normalizeVacancy,
} from "../scripts/application-rules.js";

const projectUrl = new URL("../", import.meta.url);

test("salary input is normalized to digits", () => {
  assert.equal(digitsOnly("150 000 ₽"), "150000");
  assert.equal(digitsOnly(""), "");
});

test("minimum age follows selected route", () => {
  assert.equal(minimumAgeFor("student"), 16);
  assert.equal(minimumAgeFor("relocation"), 18);
});

test("vacancy context is compatible only with its original route", () => {
  assert.equal(isVacancyRouteCompatible("student", "student"), true);
  assert.equal(isVacancyRouteCompatible("relocation", "relocation"), true);
  assert.equal(isVacancyRouteCompatible("student", "relocation"), false);
  assert.equal(isVacancyRouteCompatible("relocation", "student"), false);
});

test("age calculation respects birthday boundary", () => {
  const birthday = new Date(2008, 7, 7);
  assert.equal(calculateAgeOn(birthday, new Date(2026, 7, 6)), 17);
  assert.equal(calculateAgeOn(birthday, new Date(2026, 7, 7)), 18);
  assert.equal(calculateAgeOn(birthday, new Date(2026, 7, 8)), 18);
});

test("fallback catalog has six unique sectors and valid vacancies", async () => {
  const raw = await readFile(new URL("assets/data/vacancies.json", projectUrl), "utf8");
  const payload = JSON.parse(raw);
  const items = payload.items.map(normalizeVacancy);
  assert.ok(items.every(Boolean));
  assert.equal(Object.keys(VACANCY_SECTORS).length, 6);
  assert.deepEqual(new Set(items.map((item) => item.sector)), new Set(Object.keys(VACANCY_SECTORS)));
  assert.equal(new Set(items.map((item) => item.id)).size, items.length);
});

test("landing exposes six accessible sector controls and required resume", async () => {
  const html = await readFile(new URL("index.html", projectUrl), "utf8");
  assert.equal((html.match(/data-vacancy-sector-open=/g) || []).length, 6);
  assert.match(html, /id="resume"[^>]*required/);
  assert.match(html, /id="wishSalary"[^>]*pattern="\[0-9\]\*"/);
  assert.match(html, /Живи и работай там, где другие мечтают отдыхать/);
  assert.match(html, /scripts\/main\.js\?v=20260806-4/);

  const main = await readFile(new URL("scripts/main.js", projectUrl), "utf8");
  assert.match(main, /api-client\.js\?v=20260806-3/);
  assert.doesNotMatch(main, /clientFingerprint|createFingerprint/);
  assert.doesNotMatch(main, /if \(normalizedRemote\.length\)/);
});

test("a logical submit attempt freezes keys, timestamp and exact payload across manual retries", () => {
  const attempt = createSubmitAttempt(() => new Date("2026-08-06T09:00:00.000Z"));
  const payload = bindSubmitAttemptPayload(attempt, { schemaVersion: "landing.application@1" });
  const replayPayload = bindSubmitAttemptPayload(attempt, { schemaVersion: "changed" });

  assert.equal(attempt.submittedAt, "2026-08-06T09:00:00.000Z");
  assert.equal(replayPayload, payload);
  assert.deepEqual(replayPayload, { schemaVersion: "landing.application@1" });
  assert.ok(Object.isFrozen(replayPayload));
});

test("public writes reuse one stable idempotency key across transient retries", async () => {
  const calls = [];
  const responses = [
    new Response(JSON.stringify({
      code: "temporary_failure",
      message: "Повторите загрузку",
      requestId: "req_upload_retry",
      errors: [],
    }), {
      status: 503,
      headers: { "content-type": "application/json" },
    }),
    new Response(JSON.stringify({
      fileId: "file_01",
      name: "resume.pdf",
      size: 15,
      status: "quarantined",
      bindingToken: "binding-token-that-is-longer-than-thirty-two-characters",
    }), {
      status: 201,
      headers: { "content-type": "application/json" },
    }),
    new Response(JSON.stringify({
      code: "temporary_failure",
      message: "Повторите запрос",
      requestId: "req_retry",
      errors: [],
    }), {
      status: 503,
      headers: { "content-type": "application/json" },
    }),
    new Response(JSON.stringify({
      applicationId: "app_01",
      status: "received",
      createdAt: "2026-08-06T09:00:00.000Z",
    }), {
      status: 201,
      headers: { "content-type": "application/json" },
    }),
  ];
  const client = new ApiClient({
    fetch: async (url, init) => {
      calls.push({ url, init });
      return responses.shift();
    },
    maxRetries: 1,
    retryDelayMs: 0,
  });
  const keys = createSubmitAttemptKeys();

  const uploadReceipt = await client.uploadFile(
    new File(["%PDF-1.7\n%%EOF\n"], "resume.pdf", { type: "application/pdf" }),
    undefined,
    keys.upload,
  );
  const receipt = await client.submitApplication({
    schemaVersion: "landing.application@1",
    personal: {
      surname: "Иванов",
      name: "Иван",
      birthdate: "1990-06-12",
      email: "ivan@example.test",
      phone: "+79111112233",
    },
    application: {
      applicantType: "relocation",
      region: "Москва",
      sphere: "engineering",
      wishPost: "Инженер",
    },
    consents: {
      privacyAccepted: true,
      privacyPolicyVersion: "landing-inline-2026-08-06",
      acceptedAt: "2026-08-06T09:00:00.000Z",
    },
    attachments: {
      resumeFileId: uploadReceipt.fileId,
      resumeFileBindingToken: uploadReceipt.bindingToken,
    },
  }, undefined, keys.application);

  assert.equal(uploadReceipt.fileId, "file_01");
  assert.match(uploadReceipt.bindingToken, /^binding-token/);
  assert.equal(receipt.applicationId, "app_01");
  assert.notEqual(keys.upload, keys.application);
  assert.match(keys.upload, /^upload:[A-Za-z0-9-]+$/);
  assert.match(keys.application, /^application:[A-Za-z0-9-]+$/);
  assert.equal(calls.length, 4);
  assert.ok(calls.slice(0, 2).every(({ url }) => url === "/public/v1/uploads"));
  assert.ok(calls.slice(0, 2).every(({ init }) => init.headers.get("idempotency-key") === keys.upload));
  assert.ok(calls.slice(0, 2).every(({ init }) => init.headers.has("content-type") === false));
  assert.ok(calls.slice(0, 2).every(({ init }) => init.body instanceof FormData));
  assert.equal(calls[0].init.body, calls[1].init.body);
  assert.ok(calls.slice(2).every(({ url }) => url === "/public/v1/applications"));
  assert.ok(calls.slice(2).every(({ init }) => init.headers.get("idempotency-key") === keys.application));
  assert.ok(calls.every(({ init }) => init.credentials === "omit"));
  assert.equal(calls[2].init.body, calls[3].init.body);
});

test("vacancy client follows signed cursor pages and rejects duplicate rows", async () => {
  const urls = [];
  const responses = [
    { items: [{ id: "vac_01" }], page: { nextCursor: "cursor_02", hasMore: true, limit: 100 } },
    { items: [{ id: "vac_02" }], page: { nextCursor: null, hasMore: false, limit: 100 } },
  ];
  const client = new ApiClient({
    fetch: async (url) => {
      urls.push(url);
      return new Response(JSON.stringify(responses.shift()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    maxRetries: 0,
  });

  assert.deepEqual(await client.getVacancies("medicine"), [{ id: "vac_01" }, { id: "vac_02" }]);
  assert.match(urls[0], /sector=medicine/);
  assert.match(urls[1], /cursor=cursor_02/);
});

test("application success requires the exact receipt contract", async () => {
  const client = new ApiClient({
    fetch: async () => new Response("<html>landing fallback</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }),
    maxRetries: 0,
  });

  await assert.rejects(
    client.submitApplication({ schemaVersion: "landing.application@1" }, undefined, "application:stable-key-02"),
    (error) => error instanceof ApiError && error.code === "invalid_response_contract",
  );
});

test("API error preserves the backend machine-readable code", async () => {
  const client = new ApiClient({
    fetch: async () => new Response(JSON.stringify({
      code: "idempotency_conflict",
      message: "Key conflict",
      requestId: "req_conflict",
      errors: [],
    }), {
      status: 409,
      headers: { "content-type": "application/json" },
    }),
    maxRetries: 0,
  });

  await assert.rejects(
    client.submitApplication({ lead: true }, undefined, "application:stable-key-01"),
    (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "idempotency_conflict");
      assert.equal(error.requestId, "req_conflict");
      return true;
    },
  );
});

test("unsafe POST cannot opt into retries without an idempotency key", async () => {
  let calls = 0;
  const client = new ApiClient({
    fetch: async () => {
      calls += 1;
      throw new Error("network down");
    },
    maxRetries: 2,
    retryDelayMs: 0,
  });

  await assert.rejects(
    client.request("POST", "/unsafe-write", { body: { lead: true }, retry: true }),
    ApiError,
  );
  assert.equal(calls, 1);
});
