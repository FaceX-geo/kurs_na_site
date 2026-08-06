import { type Kysely, sql, type Transaction } from "kysely";
import type { Database } from "../../../../db/types.js";
import { CREDENTIAL_DELIVERY_CONSUMER, CREDENTIAL_DELIVERY_TOPIC } from "../contracts.js";
import type { ClaimedCredentialDelivery, CredentialDeliveryQueuePort, CredentialRecord } from "../ports.js";

interface ClaimedEventRow {
  readonly event_id: string;
  readonly aggregate_id: string;
  readonly idempotency_key: string;
  readonly payload: unknown;
  readonly attempt_count: number;
}

export interface PostgresCredentialDeliveryQueueOptions {
  readonly workerId: string;
  readonly lockTtlSeconds: number;
}

function claimLost(): Error {
  return Object.assign(new Error("Credential delivery claim is no longer owned"), {
    code: "CREDENTIAL_DELIVERY_CLAIM_LOST",
  });
}

export class PostgresCredentialDeliveryQueue implements CredentialDeliveryQueuePort {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly options: PostgresCredentialDeliveryQueueOptions,
  ) {}

  async claimNext(): Promise<ClaimedCredentialDelivery | null> {
    const result = await sql<ClaimedEventRow>`
      WITH candidate AS (
        SELECT id
        FROM platform.outbox_event
        WHERE topic = ${CREDENTIAL_DELIVERY_TOPIC}
          AND delivered_at IS NULL
          AND available_at <= clock_timestamp()
          AND (
            locked_at IS NULL
            OR locked_at < clock_timestamp() - make_interval(secs => ${this.options.lockTtlSeconds})
          )
        ORDER BY occurred_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE platform.outbox_event AS event
      SET locked_at = clock_timestamp(),
          locked_by = ${this.options.workerId},
          attempt_count = event.attempt_count + 1,
          last_error_code = NULL
      FROM candidate
      WHERE event.id = candidate.id
      RETURNING event.id AS event_id,
                event.aggregate_id,
                event.idempotency_key,
                event.payload,
                event.attempt_count
    `.execute(this.db);
    const row = result.rows[0];
    return row
      ? {
          eventId: row.event_id,
          aggregateId: row.aggregate_id,
          idempotencyKey: row.idempotency_key,
          payload: row.payload,
          attemptCount: row.attempt_count,
        }
      : null;
  }

  async wasProcessed(eventId: string): Promise<boolean> {
    const row = await this.db
      .selectFrom("platform.inbox_event")
      .select("event_id")
      .where("consumer", "=", CREDENTIAL_DELIVERY_CONSUMER)
      .where("event_id", "=", eventId)
      .executeTakeFirst();
    return Boolean(row);
  }

  async loadCredential(tokenId: string): Promise<CredentialRecord | null> {
    const row = await this.db
      .selectFrom("identity.password_token as token")
      .innerJoin("identity.user_account as account", "account.id", "token.user_account_id")
      .select([
        "token.id as tokenId",
        "token.user_account_id as userAccountId",
        "token.purpose as purpose",
        "token.expires_at as expiresAt",
        "token.used_at as usedAt",
        "token.revoked_at as revokedAt",
        "account.email as accountEmail",
        "account.account_state as accountState",
        "account.credential_state as credentialState",
        "account.archived_at as accountArchivedAt",
      ])
      .where("token.id", "=", tokenId)
      .executeTakeFirst();
    return row ?? null;
  }

  async acknowledgeReplay(claim: ClaimedCredentialDelivery): Promise<void> {
    await this.db.transaction().execute(async (transaction) => {
      await this.assertOwned(transaction, claim);
      await this.markOutboxTerminal(transaction, claim.eventId, null);
    });
  }

  async recordDelivered(claim: ClaimedCredentialDelivery, providerReference: string | null): Promise<void> {
    await this.db.transaction().execute(async (transaction) => {
      await this.assertOwned(transaction, claim);
      const now = new Date();
      const result = providerReference
        ? { outcome: "delivered", attemptCount: claim.attemptCount, providerReference }
        : { outcome: "delivered", attemptCount: claim.attemptCount };
      await transaction
        .insertInto("platform.inbox_event")
        .values({
          consumer: CREDENTIAL_DELIVERY_CONSUMER,
          event_id: claim.eventId,
          result,
          processed_at: now,
        })
        .onConflict((conflict) => conflict.columns(["consumer", "event_id"]).doNothing())
        .execute();
      await transaction
        .insertInto("identity.credential_delivery")
        .values({
          outbox_event_id: claim.eventId,
          state: "delivered",
          attempt_count: claim.attemptCount,
          next_attempt_at: null,
          last_error_code: null,
          provider_reference: providerReference,
          delivered_at: now,
          dead_lettered_at: null,
          updated_at: now,
        })
        .onConflict((conflict) =>
          conflict.column("outbox_event_id").doUpdateSet({
            state: "delivered",
            attempt_count: claim.attemptCount,
            next_attempt_at: null,
            last_error_code: null,
            provider_reference: providerReference,
            delivered_at: now,
            dead_lettered_at: null,
            updated_at: now,
          }),
        )
        .execute();
      await this.markOutboxTerminal(transaction, claim.eventId, null);
    });
  }

  async scheduleRetry(claim: ClaimedCredentialDelivery, errorCode: string, retryAt: Date): Promise<void> {
    await this.db.transaction().execute(async (transaction) => {
      await this.assertOwned(transaction, claim);
      const now = new Date();
      await transaction
        .insertInto("identity.credential_delivery")
        .values({
          outbox_event_id: claim.eventId,
          state: "retry_wait",
          attempt_count: claim.attemptCount,
          next_attempt_at: retryAt,
          last_error_code: errorCode,
          provider_reference: null,
          delivered_at: null,
          dead_lettered_at: null,
          updated_at: now,
        })
        .onConflict((conflict) =>
          conflict.column("outbox_event_id").doUpdateSet({
            state: "retry_wait",
            attempt_count: claim.attemptCount,
            next_attempt_at: retryAt,
            last_error_code: errorCode,
            provider_reference: null,
            delivered_at: null,
            dead_lettered_at: null,
            updated_at: now,
          }),
        )
        .execute();
      await transaction
        .updateTable("platform.outbox_event")
        .set({
          available_at: retryAt,
          locked_at: null,
          locked_by: null,
          last_error_code: errorCode,
        })
        .where("id", "=", claim.eventId)
        .where("locked_by", "=", this.options.workerId)
        .executeTakeFirstOrThrow();
    });
  }

  async recordDeadLetter(claim: ClaimedCredentialDelivery, errorCode: string): Promise<void> {
    await this.db.transaction().execute(async (transaction) => {
      await this.assertOwned(transaction, claim);
      const now = new Date();
      await transaction
        .insertInto("platform.inbox_event")
        .values({
          consumer: CREDENTIAL_DELIVERY_CONSUMER,
          event_id: claim.eventId,
          result: { outcome: "dead_lettered", attemptCount: claim.attemptCount, errorCode },
          processed_at: now,
        })
        .onConflict((conflict) => conflict.columns(["consumer", "event_id"]).doNothing())
        .execute();
      await transaction
        .insertInto("identity.credential_delivery")
        .values({
          outbox_event_id: claim.eventId,
          state: "dead_lettered",
          attempt_count: claim.attemptCount,
          next_attempt_at: null,
          last_error_code: errorCode,
          provider_reference: null,
          delivered_at: null,
          dead_lettered_at: now,
          updated_at: now,
        })
        .onConflict((conflict) =>
          conflict.column("outbox_event_id").doUpdateSet({
            state: "dead_lettered",
            attempt_count: claim.attemptCount,
            next_attempt_at: null,
            last_error_code: errorCode,
            provider_reference: null,
            delivered_at: null,
            dead_lettered_at: now,
            updated_at: now,
          }),
        )
        .execute();
      await this.markOutboxTerminal(transaction, claim.eventId, errorCode);
    });
  }

  private async assertOwned(
    transaction: Transaction<Database>,
    claim: ClaimedCredentialDelivery,
  ): Promise<void> {
    const event = await transaction
      .selectFrom("platform.outbox_event")
      .select(["id", "delivered_at", "locked_by"])
      .where("id", "=", claim.eventId)
      .forUpdate()
      .executeTakeFirst();
    if (!event || event.delivered_at || event.locked_by !== this.options.workerId) {
      throw claimLost();
    }
  }

  private async markOutboxTerminal(
    transaction: Transaction<Database>,
    eventId: string,
    errorCode: string | null,
  ): Promise<void> {
    await transaction
      .updateTable("platform.outbox_event")
      .set({
        delivered_at: new Date(),
        locked_at: null,
        locked_by: null,
        last_error_code: errorCode,
      })
      .where("id", "=", eventId)
      .where("locked_by", "=", this.options.workerId)
      .executeTakeFirstOrThrow();
  }
}
