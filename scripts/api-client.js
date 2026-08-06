const DEFAULT_RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_VACANCY_PAGES = 20;

export function createIdempotencyKey(scope = "request") {
  const normalizedScope = String(scope)
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24) || "request";
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") {
    return `${normalizedScope}:${cryptoApi.randomUUID()}`;
  }
  if (typeof cryptoApi?.getRandomValues !== "function") {
    throw new ApiError("Браузер не поддерживает безопасную отправку формы.", {
      code: "secure_random_unavailable",
    });
  }
  const randomBytes = cryptoApi.getRandomValues(new Uint8Array(16));
  const randomHex = Array.from(randomBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${normalizedScope}:${randomHex}`;
}

export function createSubmitAttemptKeys() {
  return Object.freeze({
    upload: createIdempotencyKey("upload"),
    application: createIdempotencyKey("application"),
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

export function createSubmitAttempt(now = () => new Date()) {
  return Object.seal({
    keys: createSubmitAttemptKeys(),
    submittedAt: now().toISOString(),
    payload: null,
  });
}

export function bindSubmitAttemptPayload(attempt, payload) {
  if (!attempt || typeof attempt !== "object") {
    throw new TypeError("submit attempt is required");
  }
  if (attempt.payload) {
    return attempt.payload;
  }
  attempt.payload = deepFreeze(payload);
  return attempt.payload;
}

export class ApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "ApiError";
    this.code = options.code || "";
    this.status = options.status ?? 0;
    this.requestId = options.requestId ?? "";
    this.errors = Array.isArray(options.errors) ? options.errors : [];
    this.payload = options.payload ?? null;
  }
}

export default class ApiClient {
  constructor(options = {}) {
    this.baseUrl = (options.baseUrl || "/public/v1").replace(/\/$/, "");
    this.token = options.token || "";
    this.maxRetries = Number.isInteger(options.maxRetries) ? options.maxRetries : 2;
    this.retryDelayMs = Number.isInteger(options.retryDelayMs) ? options.retryDelayMs : 350;
    this.fetchImpl = options.fetch || globalThis.fetch?.bind(globalThis);
  }

  setToken(token) {
    this.token = token || "";
  }

  async getSpheres(signal) {
    const data = await this.request("GET", "/dictionaries/spheres", { signal });
    if (Array.isArray(data)) {
      return data;
    }
    if (Array.isArray(data?.items)) {
      return data.items;
    }
    return [];
  }

  async getVacancies(sector, signal) {
    const items = [];
    const seenCursors = new Set();
    const seenIds = new Set();
    let cursor = "";

    for (let page = 0; page < MAX_VACANCY_PAGES; page += 1) {
      const query = new URLSearchParams({ limit: "100" });
      if (sector) query.set("sector", sector);
      if (cursor) query.set("cursor", cursor);
      const data = await this.request("GET", `/vacancies?${query}`, { signal });
      if (Array.isArray(data)) {
        return data;
      }
      if (!Array.isArray(data?.items)) {
        throw new ApiError("API вернул некорректный список вакансий.", {
          code: "invalid_response_contract",
          status: 502,
          payload: data,
        });
      }
      for (const item of data.items) {
        const itemId = typeof item?.id === "string" ? item.id : "";
        if (!itemId || seenIds.has(itemId)) {
          throw new ApiError("API вернул некорректную страницу вакансий.", {
            code: "invalid_response_contract",
            status: 502,
            payload: data,
          });
        }
        seenIds.add(itemId);
        items.push(item);
      }
      const nextCursor = data?.page?.nextCursor;
      if (!nextCursor) {
        return items;
      }
      if (typeof nextCursor !== "string" || seenCursors.has(nextCursor)) {
        throw new ApiError("API вернул некорректный курсор вакансий.", {
          code: "invalid_response_contract",
          status: 502,
          payload: data,
        });
      }
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }

    throw new ApiError("Список вакансий превысил безопасный лимит страниц.", {
      code: "vacancy_page_limit_exceeded",
      status: 502,
    });
  }

  async uploadFile(file, signal, idempotencyKey = createIdempotencyKey("upload")) {
    if (!(file instanceof File)) {
      throw new ApiError("Файл резюме не выбран.", { status: 422, errors: [{ field: "resume", code: "required" }] });
    }

    const formData = new FormData();
    formData.append("file", file);

    const data = await this.request("POST", "/uploads", {
      body: formData,
      idempotencyKey,
      signal,
      isMultipart: true,
    });

    if (
      typeof data?.fileId !== "string" ||
      !data.fileId ||
      typeof data?.name !== "string" ||
      !Number.isInteger(data?.size) ||
      data.size <= 0 ||
      data?.status !== "quarantined" ||
      typeof data?.bindingToken !== "string" ||
      data.bindingToken.length < 32
    ) {
      throw new ApiError("Не удалось получить идентификатор файла.", {
        code: "invalid_response_contract",
        status: 500,
        payload: data,
      });
    }

    return Object.freeze({ fileId: data.fileId, bindingToken: data.bindingToken });
  }

  async submitApplication(payload, signal, idempotencyKey = createIdempotencyKey("application")) {
    const data = await this.request("POST", "/applications", {
      body: payload,
      idempotencyKey,
      signal,
    });
    if (
      typeof data?.applicationId !== "string" ||
      !data.applicationId ||
      data?.status !== "received" ||
      typeof data?.createdAt !== "string" ||
      Number.isNaN(Date.parse(data.createdAt))
    ) {
      throw new ApiError("API не подтвердил приём заявки.", {
        code: "invalid_response_contract",
        status: 502,
        payload: data,
      });
    }
    return data;
  }

  async request(method, path, options = {}) {
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const headers = new Headers(options.headers || {});
    const retryAllowed = options.retry !== false && (
      ["GET", "HEAD", "OPTIONS"].includes(method)
      || Boolean(options.idempotencyKey)
    );

    if (this.token) {
      headers.set("Authorization", `Bearer ${this.token}`);
    }
    if (options.idempotencyKey) {
      headers.set("Idempotency-Key", options.idempotencyKey);
    }

    const isMultipart = Boolean(options.isMultipart);
    if (!isMultipart) {
      headers.set("Content-Type", "application/json");
    }

    const init = {
      method,
      credentials: "omit",
      headers,
      signal: options.signal,
    };

    if (typeof options.body !== "undefined") {
      init.body = isMultipart ? options.body : JSON.stringify(options.body);
    }

    let attempt = 0;
    while (true) {
      try {
        if (typeof this.fetchImpl !== "function") {
          throw new ApiError("Браузер не поддерживает отправку запросов.", {
            code: "fetch_unavailable",
          });
        }
        const response = await this.fetchImpl(url, init);
        const payload = await this.parseResponse(response);

        if (!response.ok) {
          const apiError = this.toApiError(response, payload);
          const shouldRetry = retryAllowed
            && attempt < this.maxRetries
            && DEFAULT_RETRY_STATUS.has(apiError.status);

          if (!shouldRetry) {
            throw apiError;
          }

          attempt += 1;
          await this.sleep(this.retryDelayMs * attempt);
          continue;
        }

        return payload;
      } catch (error) {
        if (error instanceof ApiError) {
          throw error;
        }

        const isAbort = error?.name === "AbortError";
        if (isAbort) {
          throw error;
        }

        if (!retryAllowed || attempt >= this.maxRetries) {
          throw new ApiError("Ошибка сети. Повторите попытку позже.", { payload: error });
        }

        attempt += 1;
        await this.sleep(this.retryDelayMs * attempt);
      }
    }
  }

  async parseResponse(response) {
    const contentType = response.headers.get("content-type") || "";

    if (!contentType.includes("application/json")) {
      const text = await response.text();
      return text ? { message: text } : {};
    }

    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  toApiError(response, payload) {
    const requestId = payload?.requestId || response.headers.get("x-request-id") || "";
    const errors = Array.isArray(payload?.errors) ? payload.errors : [];

    const fallbackMessage = response.status === 429
      ? "Слишком много попыток. Подождите и повторите снова."
      : "Не удалось обработать запрос.";

    const message = payload?.message || errors?.[0]?.message || fallbackMessage;

    return new ApiError(message, {
      code: payload?.code || "",
      status: response.status,
      requestId,
      errors,
      payload,
    });
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
