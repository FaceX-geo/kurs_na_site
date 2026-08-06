import { createHmac } from "node:crypto";
import type { CredentialDeliveryProviderPort, CredentialDeliveryProviderRequest } from "../ports.js";
import { CredentialDeliveryProviderError } from "../ports.js";

export interface SignedHttpsWebhookProviderOptions {
  readonly url: string;
  readonly signingSecret: string;
  readonly requestTimeoutMs: number;
  readonly fetcher?: typeof fetch;
  readonly now?: () => Date;
}

const SAFE_PROVIDER_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export class SignedHttpsWebhookCredentialProvider implements CredentialDeliveryProviderPort {
  private readonly url: URL;
  private readonly fetcher: typeof fetch;
  private readonly now: () => Date;

  constructor(private readonly options: SignedHttpsWebhookProviderOptions) {
    this.url = new URL(options.url);
    if (this.url.protocol !== "https:") {
      throw new Error("Credential delivery provider URL must use HTTPS");
    }
    if (this.url.username || this.url.password || this.url.hash) {
      throw new Error("Credential delivery provider URL must not contain credentials or a fragment");
    }
    if (options.signingSecret.length < 32) {
      throw new Error("Credential delivery webhook signing secret is too short");
    }
    if (options.requestTimeoutMs < 100 || options.requestTimeoutMs > 60_000) {
      throw new Error("Credential delivery request timeout is outside the safe range");
    }
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async deliver(request: CredentialDeliveryProviderRequest, signal?: AbortSignal) {
    const body = JSON.stringify(request);
    const timestamp = Math.floor(this.now().getTime() / 1_000).toString();
    const signature = createHmac("sha256", this.options.signingSecret)
      .update(`${timestamp}.${body}`)
      .digest("hex");
    const timeoutSignal = AbortSignal.timeout(this.options.requestTimeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

    let response: Response;
    try {
      response = await this.fetcher(this.url, {
        method: "POST",
        redirect: "error",
        headers: {
          "content-type": "application/json",
          "idempotency-key": request.idempotencyKey,
          "x-kurs-delivery-id": request.deliveryId,
          "x-kurs-delivery-schema": request.schemaVersion,
          "x-kurs-delivery-timestamp": timestamp,
          "x-kurs-delivery-signature": `v1=${signature}`,
        },
        body,
        signal: requestSignal,
      });
    } catch {
      if (signal?.aborted) {
        throw new CredentialDeliveryProviderError("CREDENTIAL_PROVIDER_ABORTED", true);
      }
      if (timeoutSignal.aborted) {
        throw new CredentialDeliveryProviderError("CREDENTIAL_PROVIDER_TIMEOUT", true);
      }
      throw new CredentialDeliveryProviderError("CREDENTIAL_PROVIDER_NETWORK", true);
    }

    if (!response.ok) {
      if (response.status === 408) {
        throw new CredentialDeliveryProviderError("CREDENTIAL_PROVIDER_TIMEOUT", true);
      }
      if (response.status === 425 || response.status === 429) {
        throw new CredentialDeliveryProviderError("CREDENTIAL_PROVIDER_RATE_LIMITED", true);
      }
      if (response.status >= 500) {
        throw new CredentialDeliveryProviderError("CREDENTIAL_PROVIDER_UNAVAILABLE", true);
      }
      throw new CredentialDeliveryProviderError("CREDENTIAL_PROVIDER_REJECTED", false);
    }

    const reference = response.headers.get("x-provider-delivery-id");
    return {
      providerReference: reference && SAFE_PROVIDER_REFERENCE.test(reference) ? reference : null,
    };
  }
}
