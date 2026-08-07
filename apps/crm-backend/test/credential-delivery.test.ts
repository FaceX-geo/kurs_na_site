import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { SignedHttpsWebhookCredentialProvider } from "../src/modules/identity/credential-delivery/adapters/signed-https-webhook-provider.js";
import {
  CREDENTIAL_DELIVERY_WEBHOOK_SCHEMA,
  credentialRetryDelayMs,
  deriveCredentialToken,
  parseCredentialDeliveryPayload,
} from "../src/modules/identity/credential-delivery/contracts.js";
import {
  type ClaimedCredentialDelivery,
  CredentialDeliveryProviderError,
  type CredentialDeliveryProviderPort,
  type CredentialDeliveryProviderRequest,
  type CredentialDeliveryQueuePort,
  type CredentialRecord,
} from "../src/modules/identity/credential-delivery/ports.js";
import { CredentialDeliveryWorker } from "../src/modules/identity/credential-delivery/worker.js";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tokenId = "019fd7d0-6789-7000-8000-000000000005";
const userAccountId = "019fd7d0-6789-7000-8000-000000000006";
const eventId = "019fd7d0-6789-7000-8000-000000000007";
const tokenSecret = "8uLd2Gc9Qm4Hx7Vs1Za5Wn0Jp6Tf3RyK";
const signingSecret = "4oJd7Lm2Qp9Xv6Ws3Ca8Fn1Hz5Rt0UyK";

function claim(overrides: Partial<ClaimedCredentialDelivery> = {}): ClaimedCredentialDelivery {
  return {
    eventId,
    aggregateId: userAccountId,
    idempotencyKey: `identity.credential.delivery_requested:${userAccountId}:${eventId}`,
    payload: {
      userAccountId,
      credentialTokenId: tokenId,
      purpose: "invite",
    },
    attemptCount: 1,
    ...overrides,
  };
}

function credential(overrides: Partial<CredentialRecord> = {}): CredentialRecord {
  return {
    tokenId,
    userAccountId,
    purpose: "invite",
    expiresAt: new Date("2026-08-06T13:00:00.000Z"),
    usedAt: null,
    revokedAt: null,
    accountEmail: "person@example.test",
    accountState: "active",
    credentialState: "invited",
    accountArchivedAt: null,
    ...overrides,
  };
}

class FakeQueue implements CredentialDeliveryQueuePort {
  readonly operations: Array<Readonly<Record<string, unknown>>> = [];
  processed = false;
  record: CredentialRecord | null = credential();

  constructor(private nextClaim: ClaimedCredentialDelivery | null = claim()) {}

  async claimNext() {
    const next = this.nextClaim;
    this.nextClaim = null;
    return next;
  }

  async wasProcessed() {
    return this.processed;
  }

  async loadCredential() {
    return this.record;
  }

  async acknowledgeReplay(deliveryClaim: ClaimedCredentialDelivery) {
    this.operations.push({ operation: "replayed", eventId: deliveryClaim.eventId });
  }

  async recordDelivered(deliveryClaim: ClaimedCredentialDelivery, providerReference: string | null) {
    this.operations.push({
      operation: "delivered",
      eventId: deliveryClaim.eventId,
      providerReference,
    });
  }

  async scheduleRetry(deliveryClaim: ClaimedCredentialDelivery, errorCode: string, retryAt: Date) {
    this.operations.push({
      operation: "retry",
      eventId: deliveryClaim.eventId,
      errorCode,
      retryAt: retryAt.toISOString(),
    });
  }

  async recordDeadLetter(deliveryClaim: ClaimedCredentialDelivery, errorCode: string) {
    this.operations.push({
      operation: "dead_lettered",
      eventId: deliveryClaim.eventId,
      errorCode,
    });
  }
}

function worker(
  queue: FakeQueue,
  provider: CredentialDeliveryProviderPort,
  overrides: Partial<ConstructorParameters<typeof CredentialDeliveryWorker>[2]> = {},
) {
  return new CredentialDeliveryWorker(queue, provider, {
    batchSize: 10,
    maxAttempts: 3,
    baseBackoffMs: 5_000,
    maxBackoffMs: 10_000,
    tokenSecret,
    now: () => new Date("2026-08-06T12:00:00.000Z"),
    ...overrides,
  });
}

describe("credential delivery contracts", () => {
  it("keeps raw credentials out of the outbox contract and derives them from a dedicated secret", () => {
    const payload = claim().payload;
    expect(parseCredentialDeliveryPayload(payload)).toEqual(payload);
    expect(
      parseCredentialDeliveryPayload({
        ...(payload as Readonly<Record<string, unknown>>),
        rawToken: "must-not-pass",
      }),
    ).toBeNull();
    expect(
      parseCredentialDeliveryPayload({
        ...(payload as Readonly<Record<string, unknown>>),
        destination: "person@example.test",
      }),
    ).toBeNull();

    const value = deriveCredentialToken(tokenId, "invite", tokenSecret);
    expect(value).toMatch(new RegExp(`^${tokenId}\\.[A-Za-z0-9_-]{43}$`, "u"));
    expect(deriveCredentialToken(tokenId, "invite", tokenSecret)).toBe(value);
    expect(deriveCredentialToken(tokenId, "invite", signingSecret)).not.toBe(value);
    expect(JSON.stringify(payload)).not.toContain(value);
    expect(JSON.stringify(payload)).not.toContain("person@example.test");
  });

  it("bounds exponential backoff", () => {
    expect(credentialRetryDelayMs(1, 5_000, 12_000)).toBe(5_000);
    expect(credentialRetryDelayMs(2, 5_000, 12_000)).toBe(10_000);
    expect(credentialRetryDelayMs(3, 5_000, 12_000)).toBe(12_000);
    expect(credentialRetryDelayMs(20, 5_000, 12_000)).toBe(12_000);
  });
});

describe("signed HTTPS credential provider", () => {
  it("signs the exact body and sends deterministic idempotency headers", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(null, {
        status: 202,
        headers: { "x-provider-delivery-id": "provider:message-42" },
      });
    });
    const provider = new SignedHttpsWebhookCredentialProvider({
      url: "https://delivery.example.test/hooks/credentials",
      signingSecret,
      requestTimeoutMs: 5_000,
      fetcher,
      now: () => new Date("2026-08-06T12:00:00.000Z"),
    });
    const request: CredentialDeliveryProviderRequest = {
      schemaVersion: CREDENTIAL_DELIVERY_WEBHOOK_SCHEMA,
      deliveryId: eventId,
      idempotencyKey: claim().idempotencyKey,
      userAccountId,
      purpose: "invite" as const,
      destination: "person@example.test",
      oneTimeCredential: deriveCredentialToken(tokenId, "invite", tokenSecret),
      expiresAt: "2026-08-06T13:00:00.000Z",
    };

    await expect(provider.deliver(request)).resolves.toEqual({
      providerReference: "provider:message-42",
    });
    expect(capturedUrl).toBe("https://delivery.example.test/hooks/credentials");
    const body = String(capturedInit?.body);
    const timestamp = "1786017600";
    const expectedSignature = createHmac("sha256", signingSecret)
      .update(`${timestamp}.${body}`)
      .digest("hex");
    const headers = new Headers(capturedInit?.headers);
    expect(JSON.parse(body)).toEqual(request);
    expect(headers.get("idempotency-key")).toBe(request.idempotencyKey);
    expect(headers.get("x-kurs-delivery-timestamp")).toBe(timestamp);
    expect(headers.get("x-kurs-delivery-signature")).toBe(`v1=${expectedSignature}`);
    expect(capturedInit?.redirect).toBe("error");
  });

  it("rejects plaintext providers and maps responses to safe retry policy", async () => {
    expect(
      () =>
        new SignedHttpsWebhookCredentialProvider({
          url: "http://delivery.example.test/hooks/credentials",
          signingSecret,
          requestTimeoutMs: 5_000,
        }),
    ).toThrow(/must use HTTPS/u);

    const provider = new SignedHttpsWebhookCredentialProvider({
      url: "https://delivery.example.test/hooks/credentials",
      signingSecret,
      requestTimeoutMs: 5_000,
      fetcher: vi.fn<typeof fetch>(async () => new Response("ignored-provider-body", { status: 429 })),
    });
    const request: CredentialDeliveryProviderRequest = {
      schemaVersion: CREDENTIAL_DELIVERY_WEBHOOK_SCHEMA,
      deliveryId: eventId,
      idempotencyKey: claim().idempotencyKey,
      userAccountId,
      purpose: "invite" as const,
      destination: "person@example.test",
      oneTimeCredential: deriveCredentialToken(tokenId, "invite", tokenSecret),
      expiresAt: "2026-08-06T13:00:00.000Z",
    };
    await expect(provider.deliver(request)).rejects.toMatchObject({
      code: "CREDENTIAL_PROVIDER_RATE_LIMITED",
      retryable: true,
      message: "CREDENTIAL_PROVIDER_RATE_LIMITED",
    });
  });
});

describe("credential delivery worker", () => {
  it("derives the credential only for provider memory and records a safe receipt", async () => {
    const queue = new FakeQueue();
    let providerRequest: unknown;
    const provider: CredentialDeliveryProviderPort = {
      async deliver(request) {
        providerRequest = request;
        return { providerReference: "provider:message-42" };
      },
    };

    await expect(worker(queue, provider).runBatch()).resolves.toEqual({
      claimed: 1,
      delivered: 1,
      retried: 0,
      deadLettered: 0,
      replayed: 0,
    });
    expect(providerRequest).toMatchObject({
      deliveryId: eventId,
      destination: "person@example.test",
      oneTimeCredential: deriveCredentialToken(tokenId, "invite", tokenSecret),
    });
    expect(queue.operations).toEqual([
      { operation: "delivered", eventId, providerReference: "provider:message-42" },
    ]);
    expect(JSON.stringify(queue.operations)).not.toContain(
      deriveCredentialToken(tokenId, "invite", tokenSecret),
    );
  });

  it("retries transient failures with bounded backoff and dead-letters at max attempts", async () => {
    const provider: CredentialDeliveryProviderPort = {
      async deliver() {
        throw new CredentialDeliveryProviderError("CREDENTIAL_PROVIDER_UNAVAILABLE", true);
      },
    };
    const retryQueue = new FakeQueue(claim({ attemptCount: 2 }));
    await worker(retryQueue, provider).runBatch();
    expect(retryQueue.operations).toEqual([
      {
        operation: "retry",
        eventId,
        errorCode: "CREDENTIAL_PROVIDER_UNAVAILABLE",
        retryAt: "2026-08-06T12:00:10.000Z",
      },
    ]);

    const exhaustedQueue = new FakeQueue(claim({ attemptCount: 3 }));
    await worker(exhaustedQueue, provider).runBatch();
    expect(exhaustedQueue.operations).toEqual([
      {
        operation: "dead_lettered",
        eventId,
        errorCode: "CREDENTIAL_PROVIDER_UNAVAILABLE",
      },
    ]);
  });

  it("uses inbox replay protection and fails invalid/token-stale events terminally", async () => {
    const provider = { deliver: vi.fn<CredentialDeliveryProviderPort["deliver"]>() };
    const replayQueue = new FakeQueue();
    replayQueue.processed = true;
    await worker(replayQueue, provider).runBatch();
    expect(provider.deliver).not.toHaveBeenCalled();
    expect(replayQueue.operations).toEqual([{ operation: "replayed", eventId }]);

    const invalidQueue = new FakeQueue(claim({ payload: { rawToken: "forbidden" } }));
    await worker(invalidQueue, provider).runBatch();
    expect(invalidQueue.operations).toEqual([
      { operation: "dead_lettered", eventId, errorCode: "CREDENTIAL_PAYLOAD_INVALID" },
    ]);

    const staleQueue = new FakeQueue();
    staleQueue.record = credential({ revokedAt: new Date("2026-08-06T11:00:00.000Z") });
    await worker(staleQueue, provider).runBatch();
    expect(staleQueue.operations).toEqual([
      { operation: "dead_lettered", eventId, errorCode: "CREDENTIAL_TOKEN_UNAVAILABLE" },
    ]);

    const invalidDestinationQueue = new FakeQueue();
    invalidDestinationQueue.record = credential({ accountEmail: "not-an-email" });
    await worker(invalidDestinationQueue, provider).runBatch();
    expect(invalidDestinationQueue.operations).toEqual([
      { operation: "dead_lettered", eventId, errorCode: "CREDENTIAL_DESTINATION_INVALID" },
    ]);
    expect(provider.deliver).not.toHaveBeenCalled();
  });
});

describe("credential delivery migration boundary", () => {
  it("persists only safe delivery state and grants a dedicated least-privilege role", async () => {
    const [migration, roleInit] = await Promise.all([
      readFile(path.join(appRoot, "db/migrations/0080_credential_delivery_runtime.up.sql"), "utf8"),
      readFile(path.join(appRoot, "deploy/postgres-init/10-runtime-roles.sh"), "utf8"),
    ]);
    expect(migration).toContain("CREATE TABLE identity.credential_delivery");
    expect(migration).toContain("dead_lettered");
    expect(migration).toContain("GRANT UPDATE (available_at, attempt_count");
    expect(migration).toContain(
      "GRANT SELECT (id, email, account_state, credential_state, archived_at) ON identity.user_account",
    );
    expect(migration).toContain("REVOKE ALL ON identity.credential_delivery FROM kurs_crm_api");
    expect(migration).not.toMatch(/raw.?token|one.?time.?credential/iu);
    expect(roleInit).toContain("kurs_crm_credential_worker");
    expect(roleInit).toContain("NOCREATEDB NOCREATEROLE NOREPLICATION");
  });
});
