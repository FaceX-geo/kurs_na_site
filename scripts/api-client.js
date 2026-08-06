const DEFAULT_RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

export class ApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "ApiError";
    this.status = options.status ?? 0;
    this.requestId = options.requestId ?? "";
    this.errors = Array.isArray(options.errors) ? options.errors : [];
    this.payload = options.payload ?? null;
  }
}

export default class ApiClient {
  constructor(options = {}) {
    this.baseUrl = (options.baseUrl || "/api/v1").replace(/\/$/, "");
    this.token = options.token || "";
    this.maxRetries = Number.isInteger(options.maxRetries) ? options.maxRetries : 2;
    this.retryDelayMs = Number.isInteger(options.retryDelayMs) ? options.retryDelayMs : 350;
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
    const query = sector ? `?sector=${encodeURIComponent(sector)}` : "";
    const data = await this.request("GET", `/vacancies${query}`, { signal });
    if (Array.isArray(data)) {
      return data;
    }
    if (Array.isArray(data?.items)) {
      return data.items;
    }
    return [];
  }

  async uploadFile(file, signal) {
    if (!(file instanceof File)) {
      throw new ApiError("Файл резюме не выбран.", { status: 422, errors: [{ field: "resume", code: "required" }] });
    }

    const formData = new FormData();
    formData.append("file", file);

    const data = await this.request("POST", "/files", {
      body: formData,
      signal,
      isMultipart: true,
    });

    if (!data?.fileId) {
      throw new ApiError("Не удалось получить идентификатор файла.", {
        status: 500,
        payload: data,
      });
    }

    return data.fileId;
  }

  async submitApplication(payload, signal) {
    return this.request("POST", "/applications", {
      body: payload,
      signal,
    });
  }

  async request(method, path, options = {}) {
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const headers = new Headers(options.headers || {});
    const retryAllowed = options.retry === true
      || (options.retry !== false && ["GET", "HEAD", "OPTIONS"].includes(method));

    if (this.token) {
      headers.set("Authorization", `Bearer ${this.token}`);
    }

    const isMultipart = Boolean(options.isMultipart);
    if (!isMultipart) {
      headers.set("Content-Type", "application/json");
    }

    const init = {
      method,
      headers,
      signal: options.signal,
    };

    if (typeof options.body !== "undefined") {
      init.body = isMultipart ? options.body : JSON.stringify(options.body);
    }

    let attempt = 0;
    while (true) {
      try {
        const response = await fetch(url, init);
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
