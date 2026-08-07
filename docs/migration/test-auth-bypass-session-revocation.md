# Revocation and retirement of test-auth bypass sessions

`CRM_TEST_AUTH_BYPASS=true` is permitted only in `NODE_ENV=test`. A session created in this mode
receives `fresh_mfa`, while the durable audit chain records
`identity.session.test_mfa_bypass_authenticated`.

The current `identity.session` schema does not store per-session bypass provenance, and a user's
role can change after authentication. Matching by timestamp or current role would be unsafe. The
cleanup therefore deliberately revokes every still-active session of every account that has any
durable bypass-auth audit event. This may also revoke a later legitimate session for the same
account; the operator must accept that bounded availability impact to guarantee that no
bypass-created session survives.

The cleanup and bypass login share one PostgreSQL advisory transaction lock. Cleanup writes the
durable `identity.session.test_mfa_bypass_retired` marker in the same transaction as revocation.
The updated API checks that marker while holding the lock and fails closed before issuing a new
bypass session. This fence closes races between login and cleanup, but an old binary that does not
know the marker must be stopped or replaced before cleanup.

## Required sequence

1. Deploy the updated API binary containing the shared fence, recreate it with
   `CRM_NODE_ENV=production` and `CRM_TEST_AUTH_BYPASS=false`, then verify the running image,
   configuration and readiness. Stop/replace every old API replica before cleanup. Do not run
   cleanup while an unfenced or bypass-enabled API can create another session.
2. Run the one-shot command through the existing migrator service and exact confirmation gate:

```sh
docker --context remote-build compose --env-file /secure/path/crm.env \
  run --rm --no-deps \
  -e CRM_TEST_AUTH_BYPASS=false \
  -e CRM_TEST_BYPASS_SESSION_REVOCATION_CONFIRM=REVOKE_ALL_ACTIVE_SESSIONS_FOR_ACCOUNTS_WITH_TEST_BYPASS_AUDIT \
  migrate node dist/test-bypass-superadmin-session-revoke-once.js
```

The command changes only non-expired, non-revoked sessions of accounts with bypass audit evidence,
independent of their current roles. Session IDs, token hashes, account IDs and PII are not printed.
Success returns only `revokedSessionCount`, `affectedAccountCount`, cleanup/retirement audit IDs and
the conservative selection policy. Session updates, retirement marker and tamper-evident aggregate
audit event commit atomically.

After the marker exists, the updated binary permanently refuses bypass issuance even if it is
accidentally started again with `CRM_TEST_AUTH_BYPASS=true`. Do not repeat cleanup casually: a
later legitimate session of an account with historical bypass evidence is intentionally in scope.
Missing/incorrect confirmation, `CRM_TEST_AUTH_BYPASS` other than exact `false`, database failure
or audit failure exits non-zero.
