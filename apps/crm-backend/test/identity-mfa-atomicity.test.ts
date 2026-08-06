import type { Kysely } from "kysely";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "../src/common/errors.js";
import { loadConfig } from "../src/config/env.js";
import type { Database } from "../src/db/types.js";
import { keyedHash } from "../src/modules/identity/crypto.js";
import { IdentityService } from "../src/modules/identity/service.js";

const config = loadConfig({
  NODE_ENV: "test",
  CURSOR_SIGNING_KEY: "mfa-test-cursor-signing-key-at-least-32-chars",
  SESSION_TOKEN_PEPPER: "mfa-test-session-token-pepper-at-least-32-chars",
});

interface ChallengeState {
  id: string;
  public_id: string;
  user_account_id: string;
  provider_code: string;
  token_hash: string;
  state: "pending" | "verified" | "locked";
  attempt_count: number;
  expires_at: Date;
  person_id: string;
  email: string;
  account_state: string;
  credential_state: string;
  risk_state: string;
  mfa_state: string;
  given_name: string;
  surname: string;
}

function createChallengeState(challengeToken: string): ChallengeState {
  return {
    id: "019fd7d0-6789-7000-8000-000000000001",
    public_id: "session_test_challenge",
    user_account_id: "019fd7d0-6789-7000-8000-000000000002",
    provider_code: "totp",
    token_hash: keyedHash(challengeToken, config.session.tokenPepper),
    state: "pending",
    attempt_count: 0,
    expires_at: new Date(Date.now() + 60_000),
    person_id: "019fd7d0-6789-7000-8000-000000000003",
    email: "user@example.test",
    account_state: "active",
    credential_state: "password_set",
    risk_state: "normal",
    mfa_state: "enrolled",
    given_name: "Иван",
    surname: "Иванов",
  };
}

function createSerializedChallengeDatabase(state: ChallengeState) {
  let tail = Promise.resolve();
  let forUpdateCalls = 0;

  const transaction = {
    selectFrom(table: string) {
      if (table !== "identity.auth_challenge as challenge") {
        throw new Error(`Unexpected select table ${table}`);
      }
      const query = {
        innerJoin() {
          return query;
        },
        select() {
          return query;
        },
        where() {
          return query;
        },
        forUpdate() {
          forUpdateCalls += 1;
          return query;
        },
        async executeTakeFirst() {
          return { ...state };
        },
      };
      return query;
    },
    updateTable(table: string) {
      if (table !== "identity.auth_challenge") {
        throw new Error(`Unexpected update table ${table}`);
      }
      let values: Partial<ChallengeState> = {};
      const query = {
        set(next: Partial<ChallengeState>) {
          values = next;
          return query;
        },
        where() {
          return query;
        },
        returning() {
          return query;
        },
        async executeTakeFirst() {
          if (state.state !== "pending") {
            return undefined;
          }
          Object.assign(state, values);
          return { id: state.id };
        },
      };
      return query;
    },
  };

  const database = {
    transaction() {
      return {
        execute<T>(callback: (value: typeof transaction) => Promise<T>): Promise<T> {
          const run = tail.then(() => callback(transaction));
          tail = run.then(
            () => undefined,
            () => undefined,
          );
          return run;
        },
      };
    },
  } as unknown as Kysely<Database>;

  return { database, state, getForUpdateCalls: () => forUpdateCalls };
}

function rejectionCode(result: PromiseSettledResult<unknown>): string {
  if (result.status === "fulfilled") {
    return "fulfilled";
  }
  return (result.reason as AppError).code;
}

describe("identity MFA challenge atomicity", () => {
  it("serializes concurrent failures and locks the challenge exactly on the fifth attempt", async () => {
    const challengeToken = "challenge-token-with-at-least-thirty-two-characters";
    const fixture = createSerializedChallengeDatabase(createChallengeState(challengeToken));
    const service = new IdentityService(fixture.database, config);
    const verifyFactor = vi.spyOn(service, "verifyFactor").mockResolvedValue(false);

    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => service.verifyMfa("session_test_challenge", challengeToken, "000000")),
    );

    expect(results.map(rejectionCode).sort()).toEqual([
      "invalid_mfa_challenge",
      "invalid_mfa_code",
      "invalid_mfa_code",
      "invalid_mfa_code",
      "invalid_mfa_code",
      "invalid_mfa_code",
    ]);
    expect(fixture.state).toMatchObject({ attempt_count: 5, state: "locked" });
    expect(verifyFactor).toHaveBeenCalledTimes(5);
    expect(fixture.getForUpdateCalls()).toBe(6);
  });

  it("rejects an unavailable account before factor verification without consuming an attempt", async () => {
    const challengeToken = "challenge-token-with-at-least-thirty-two-characters";
    const state = createChallengeState(challengeToken);
    state.account_state = "disabled";
    const fixture = createSerializedChallengeDatabase(state);
    const service = new IdentityService(fixture.database, config);
    const verifyFactor = vi.spyOn(service, "verifyFactor");

    await expect(service.verifyMfa("session_test_challenge", challengeToken, "000000")).rejects.toMatchObject(
      { statusCode: 403, code: "account_unavailable" },
    );
    expect(verifyFactor).not.toHaveBeenCalled();
    expect(state).toMatchObject({ attempt_count: 0, state: "pending" });
    expect(fixture.getForUpdateCalls()).toBe(1);
  });

  it("does not count provider configuration failures as invalid user codes", async () => {
    const challengeToken = "challenge-token-with-at-least-thirty-two-characters";
    const state = createChallengeState(challengeToken);
    const fixture = createSerializedChallengeDatabase(state);
    const service = new IdentityService(fixture.database, config);
    vi.spyOn(service, "verifyFactor").mockRejectedValue(
      new AppError(503, "mfa_provider_unconfigured", "MFA provider is unavailable"),
    );

    await expect(service.verifyMfa("session_test_challenge", challengeToken, "000000")).rejects.toMatchObject(
      { statusCode: 503, code: "mfa_provider_unconfigured" },
    );
    expect(state).toMatchObject({ attempt_count: 0, state: "pending" });
  });
});
