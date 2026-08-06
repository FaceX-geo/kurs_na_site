import type { CredentialPurpose } from "./contracts.js";

export interface ClaimedCredentialDelivery {
  readonly eventId: string;
  readonly aggregateId: string;
  readonly idempotencyKey: string;
  readonly payload: unknown;
  readonly attemptCount: number;
}

export interface CredentialRecord {
  readonly tokenId: string;
  readonly userAccountId: string;
  readonly purpose: string;
  readonly expiresAt: Date;
  readonly usedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly accountEmail: string;
  readonly accountState: string;
  readonly credentialState: string;
  readonly accountArchivedAt: Date | null;
}

export interface CredentialDeliveryProviderRequest {
  readonly schemaVersion: "credential-delivery.webhook.v1";
  readonly deliveryId: string;
  readonly idempotencyKey: string;
  readonly userAccountId: string;
  readonly purpose: CredentialPurpose;
  readonly destination: string;
  /** Exists only in process memory and the TLS request body. Never persist or log it. */
  readonly oneTimeCredential: string;
  readonly expiresAt: string;
}

export interface CredentialDeliveryProviderReceipt {
  readonly providerReference: string | null;
}

export interface CredentialDeliveryProviderPort {
  deliver(
    request: CredentialDeliveryProviderRequest,
    signal?: AbortSignal,
  ): Promise<CredentialDeliveryProviderReceipt>;
}

export class CredentialDeliveryProviderError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "CredentialDeliveryProviderError";
  }
}

export interface CredentialDeliveryQueuePort {
  claimNext(): Promise<ClaimedCredentialDelivery | null>;
  wasProcessed(eventId: string): Promise<boolean>;
  loadCredential(tokenId: string): Promise<CredentialRecord | null>;
  acknowledgeReplay(claim: ClaimedCredentialDelivery): Promise<void>;
  recordDelivered(claim: ClaimedCredentialDelivery, providerReference: string | null): Promise<void>;
  scheduleRetry(claim: ClaimedCredentialDelivery, errorCode: string, retryAt: Date): Promise<void>;
  recordDeadLetter(claim: ClaimedCredentialDelivery, errorCode: string): Promise<void>;
}
