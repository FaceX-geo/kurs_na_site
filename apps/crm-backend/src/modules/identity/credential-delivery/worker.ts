import {
  CREDENTIAL_DELIVERY_WEBHOOK_SCHEMA,
  credentialRetryDelayMs,
  deriveCredentialToken,
  parseCredentialDeliveryPayload,
} from "./contracts.js";
import {
  type ClaimedCredentialDelivery,
  CredentialDeliveryProviderError,
  type CredentialDeliveryProviderPort,
  type CredentialDeliveryQueuePort,
  type CredentialRecord,
} from "./ports.js";

export interface CredentialDeliveryWorkerOptions {
  readonly batchSize: number;
  readonly maxAttempts: number;
  readonly baseBackoffMs: number;
  readonly maxBackoffMs: number;
  readonly tokenSecret: string;
  readonly now?: () => Date;
}

export interface CredentialDeliveryBatchResult {
  readonly claimed: number;
  readonly delivered: number;
  readonly retried: number;
  readonly deadLettered: number;
  readonly replayed: number;
}

type DeliveryOutcome = "delivered" | "retried" | "dead_lettered" | "replayed";

const SAFE_ERROR_CODE = /^[A-Z0-9_]{1,96}$/u;

function normalizeProviderFailure(error: unknown): CredentialDeliveryProviderError {
  if (error instanceof CredentialDeliveryProviderError && SAFE_ERROR_CODE.test(error.code)) {
    return error;
  }
  return new CredentialDeliveryProviderError("CREDENTIAL_PROVIDER_FAILURE", true);
}

function normalizeEmail(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function credentialIsDeliverable(
  claim: ClaimedCredentialDelivery,
  payload: NonNullable<ReturnType<typeof parseCredentialDeliveryPayload>>,
  credential: CredentialRecord | null,
  now: Date,
): credential is CredentialRecord {
  if (!credential) {
    return false;
  }
  const requiredCredentialState = payload.purpose === "invite" ? "invited" : "change_required";
  return (
    claim.aggregateId === payload.userAccountId &&
    credential.tokenId === payload.credentialTokenId &&
    credential.userAccountId === payload.userAccountId &&
    credential.purpose === payload.purpose &&
    credential.accountState === "active" &&
    credential.credentialState === requiredCredentialState &&
    credential.accountArchivedAt === null &&
    credential.usedAt === null &&
    credential.revokedAt === null &&
    credential.expiresAt > now &&
    normalizeEmail(credential.accountEmail) === normalizeEmail(payload.destination)
  );
}

export class CredentialDeliveryWorker {
  private readonly now: () => Date;

  constructor(
    private readonly queue: CredentialDeliveryQueuePort,
    private readonly provider: CredentialDeliveryProviderPort,
    private readonly options: CredentialDeliveryWorkerOptions,
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async runBatch(signal?: AbortSignal): Promise<CredentialDeliveryBatchResult> {
    let claimed = 0;
    let delivered = 0;
    let retried = 0;
    let deadLettered = 0;
    let replayed = 0;

    for (let index = 0; index < this.options.batchSize && !signal?.aborted; index += 1) {
      const claim = await this.queue.claimNext();
      if (!claim) {
        break;
      }
      claimed += 1;
      const outcome = await this.processClaim(claim, signal);
      if (outcome === "delivered") delivered += 1;
      if (outcome === "retried") retried += 1;
      if (outcome === "dead_lettered") deadLettered += 1;
      if (outcome === "replayed") replayed += 1;
    }

    return { claimed, delivered, retried, deadLettered, replayed };
  }

  private async processClaim(
    claim: ClaimedCredentialDelivery,
    signal?: AbortSignal,
  ): Promise<DeliveryOutcome> {
    if (await this.queue.wasProcessed(claim.eventId)) {
      await this.queue.acknowledgeReplay(claim);
      return "replayed";
    }

    const payload = parseCredentialDeliveryPayload(claim.payload);
    if (!payload) {
      await this.queue.recordDeadLetter(claim, "CREDENTIAL_PAYLOAD_INVALID");
      return "dead_lettered";
    }

    const now = this.now();
    const credential = await this.queue.loadCredential(payload.credentialTokenId);
    if (!credentialIsDeliverable(claim, payload, credential, now)) {
      await this.queue.recordDeadLetter(claim, "CREDENTIAL_TOKEN_UNAVAILABLE");
      return "dead_lettered";
    }

    const oneTimeCredential = deriveCredentialToken(
      payload.credentialTokenId,
      payload.purpose,
      this.options.tokenSecret,
    );

    try {
      const receipt = await this.provider.deliver(
        {
          schemaVersion: CREDENTIAL_DELIVERY_WEBHOOK_SCHEMA,
          deliveryId: claim.eventId,
          idempotencyKey: claim.idempotencyKey,
          userAccountId: payload.userAccountId,
          purpose: payload.purpose,
          destination: payload.destination,
          oneTimeCredential,
          expiresAt: credential.expiresAt.toISOString(),
        },
        signal,
      );
      await this.queue.recordDelivered(claim, receipt.providerReference);
      return "delivered";
    } catch (error) {
      const failure = normalizeProviderFailure(error);
      if (!failure.retryable || claim.attemptCount >= this.options.maxAttempts) {
        await this.queue.recordDeadLetter(claim, failure.code);
        return "dead_lettered";
      }
      const delayMs = credentialRetryDelayMs(
        claim.attemptCount,
        this.options.baseBackoffMs,
        this.options.maxBackoffMs,
      );
      await this.queue.scheduleRetry(claim, failure.code, new Date(this.now().getTime() + delayMs));
      return "retried";
    }
  }
}
