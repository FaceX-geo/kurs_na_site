# Test snapshot: 22 July 2026

This runbook is intentionally test-only. It does not approve the July 22 dump for a production cutover.

## Pinned source

- dump: `sitemanager-final.sql.gz`
- SHA-256: `7d38354b78f7c30423462799f088f097cd129eb3934b4e29b3664b0f648e79bf`
- dump completion marker: `2026-07-22`
- restored MySQL version: `8.0.40`
- expected source tables: `1669`

The raw source is restored on Bravo into an internal Docker network with no published port. The CRM API is not attached to that source network. A one-shot import container is the only component allowed to join both the source and canonical PostgreSQL networks.

## Safety contract

The materializer refuses to run unless all of the following values match exactly:

```dotenv
CRM_TEST_SNAPSHOT_IMPORT=true
CRM_TEST_SNAPSHOT_IMPORT_CONFIRM=RESTORE_2026-07-22_TEST_ONLY
CRM_TEST_SNAPSHOT_SHA256=7d38354b78f7c30423462799f088f097cd129eb3934b4e29b3664b0f648e79bf
```

The operation is protected by a PostgreSQL advisory lock, deterministic source IDs, `platform.legacy_reference`, and one PostgreSQL transaction. A successful replay returns the previously recorded summary without duplicating canonical rows.

Legacy credentials, password hashes, sessions, roles, external-link secrets and Bitrix authorization state are never materialized. Duplicate contact points, unresolved ownership and unsigned funnel decisions remain review signals. The missing legacy `/upload` tree cannot be reconstructed from the SQL dump; file metadata remains in the isolated raw source, but unavailable binary content must not be represented as transferred.

## Canonical test projection

The initial frontend-ready projection is deliberately narrower than the raw source:

- `218` legacy actors, without accounts or credentials;
- `19` structurally valid employee identities;
- `2546` safe contact/person profiles;
- `797` employers;
- `1237` category-2 CRM cases with safe contact and owner dependencies;
- `38` CRM-domain tasks;
- unique supported contact points and non-conflicting employer requisites.

All remaining SQL rows stay available in the immutable isolated MySQL source and receive migration-ledger classification where covered by the approved 57-table manifest. They are not silently coerced into canonical entities that do not yet have a signed contract.

## Bravo execution

Docker and Compose commands must use `--context remote-build`. After the source restore and schema migration, run only the profile job:

```bash
docker --context remote-build compose \
  --env-file /secure/path/crm.env \
  --env-file /secure/path/legacy-mysql.env \
  --profile legacy-migration \
  run --rm test-snapshot-import
```

Acceptance requires:

1. the job exits with `TEST_SNAPSHOT_MATERIALIZED`;
2. `migration.test_snapshot_materialization.state = 'completed'`;
3. recorded counts equal the contract above;
4. API list endpoints return the canonical projection with pagination;
5. a second job run reports `alreadyCompleted=true`;
6. CRM API, worker and PostgreSQL remain healthy and logs contain no database or secret errors.
