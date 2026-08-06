# Public intake hardening — 2026-08-06

## Business outcome

The landing can bind an application only to the exact resume upload it created, and the router no
longer silently merges a partial identity match or opens a second concurrent case for the same
candidate route. Invalid vacancy and consent bindings fail as field-level `422` responses before an
intake submission is stored.

## Versioned public contracts

- `POST /public/v1/uploads` returns `fileId` and opaque `bindingToken`.
- `POST /public/v1/applications` requires both `attachments.resumeFileId` and
  `attachments.resumeFileBindingToken`.
- The explicitly deprecated `/api/v1/applications` alias may omit the binding token only for the
  compatibility window. If a token is supplied on that alias, it is always verified. Remove this
  exception after all legacy clients use `/public/v1`.
- `application.vacancyId`, when present, is resolved from the same published
  `assets/data/vacancies.json` registry served by the vacancies endpoint. ID, sector and applicant
  type must agree.
- Spheres are no longer duplicated in backend source; both landing fallback and backend adapter read
  `assets/data/spheres.json`.
- Consent policy version and acceptance timestamp form an atomic pair on every route, including the
  compatibility alias.

## Upload binding security

The raw binding credential exists only in process memory and in the HTTPS request/response. The
database stores `binding_token_hash`, `binding_key_version` and `binding_consumed_at`; the submission
JSON and idempotency response body never contain the raw credential. Application idempotency is
influenced by a keyed credential digest, not a plain token hash.

The token is deterministically reconstructed from the internal upload UUID and public file ID for an
exact upload idempotency replay. A domain-separated HMAC subkey is derived from
`CREDENTIAL_DELIVERY_TOKEN_SECRET`; the credential-delivery token format/key is not reused. Version 1
must remain available until all unconsumed uploads expire (currently 24 hours). A root-secret rotation
therefore requires either:

1. drain/consume or wait for expiry of pending uploads, then rotate; or
2. invalidate pending bindings and require clients to upload the file again.

The database insert trigger requires every new upload to have a keyed binding hash. A successful
application transaction sets both `linked_submission_id` and `binding_consumed_at`, so another
application cannot consume the file.

Object storage is outside the PostgreSQL transaction by definition. Upload now uses a durable
three-step state machine: commit `intake.upload_reservation`, write the stable object key, then
atomically create `intake.upload` + mark the reservation committed + complete idempotency. An exact
retry resumes the same reservation and object key. Code never deletes the object in a transaction
error handler because a lost COMMIT acknowledgement may hide an already committed reference.

Stale, uncommitted reservations are the only objects eligible for compensation. Run the bounded,
idempotent reconciler from the trusted API runtime environment (same DB and object-store secrets):

```sh
pnpm uploads:reconcile
```

Defaults: reservations are untouched for 48 hours (longer than the 24-hour binding validity), cleanup
claims retry after 15 minutes, and one run processes at most 100 rows. The bounded overrides are
`UPLOAD_RECONCILE_STALE_HOURS`, `UPLOAD_RECONCILE_RETRY_MINUTES`, and
`UPLOAD_RECONCILE_BATCH_SIZE`. A successful object deletion and idempotency failure marker are
recorded together; an ambiguous cleanup commit simply retries the idempotent deletion later.

`UPLOAD_MAX_BYTES` is a deploy-time runtime limit and may be set below the durable 10 MiB storage
ceiling. Startup rejects a larger value. The exported ceiling is shared by intake validation,
multipart parsing, Candidate360 document reads, TypeBox/OpenAPI schemas and object-store readers; a
future increase requires a new database migration before changing the constant.

## Identity and open-case routing

The worker serializes candidate matching by normalized email and phone advisory keys. It may reuse a
person only when exactly one active CRM profile matches all of:

- normalized email;
- normalized E.164 phone;
- normalized surname, given name and middle name;
- birth date;
- absence of an employee profile and user account for that person.

Any partial/multiple/archived/privileged identity match becomes
`INTAKE_IDENTITY_MATCH_REQUIRES_REVIEW`. The worker reads only boolean employee/account predicates
through narrow `SECURITY DEFINER` functions; it does not query credential/account tables directly.

Before participation/case creation, the worker acquires a profile+applicant-route advisory lock and
checks for an existing `open` or `needs_review` case. A duplicate submission becomes
`INTAKE_OPEN_CASE_EXISTS_FOR_ROUTE`. Migration `0110_intake_identity_and_case_guards` adds a trigger
using the same lock key as the final database-level race guard.
