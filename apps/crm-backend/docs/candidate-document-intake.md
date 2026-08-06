# Candidate documents: intake bridge and content gate

## Purpose

The public landing upload becomes document metadata on the same candidate and case created by the
intake routing worker. The worker performs the person/profile/case/document writes, audit events,
outbox events, and inbox completion in one PostgreSQL transaction. A retry cannot create a second
active document for the same upload because `candidate_document_active_upload_uidx` is the final
database guard.

`crm.candidate_document.storage_reference` is an internal opaque source reference. The bridge writes
`intake-upload:<upload UUID>`; it does not copy the object-store key. No Candidate 360 response schema
contains either `storage_reference` or `intake.upload.storage_key`.

## Read and download contract

- `ListCandidateDocuments` and `GetCandidateDocument` return metadata only after SQL row scope.
- A case-bound document is scoped through that exact case assignment. An unbound historical document
  falls back to the visible candidate scope.
- `ListCandidateRecommenders` applies SQL scope to both people in the relation.
- `GetCandidateDocumentContent` requires the separate `crm.candidate.document.download` permission.
- Content is read with an explicit 10 MiB bound, then its byte count and SHA-256 are checked against
  immutable intake metadata.
- Immediately before returning bytes, the repository re-checks exact case scope and
  `intake.upload.scan_state = 'clean'` under a shared row lock and appends a metadata-only audit event.
- Responses are `private, no-store`, use a sanitised `Content-Disposition`, and never return an object
  key.

## Malware scanner gate

This application does not invent or emulate a malware scanner. Public uploads start in
`quarantined`. Until an approved scanner integration changes the row to `clean`, content download
fails closed with `423 document_scan_pending`. `rejected` and `scan_failed` files are never returned.
Metadata remains visible to an authorised operator so the stalled or rejected state can be handled.

Production content therefore remains unavailable until the security/process owner approves a real
scanner provider, its signature policy, retry/dead-letter handling, retention policy, and an
operator-visible remediation queue.

## Composition wiring

The composition root already constructs one `objectStore` for intake. Wire that same bounded port to
Candidate 360; no second bucket or hidden adapter is required:

```ts
const candidate360Service = createCandidate360Service({
  repository: new PostgresCandidate360Repository(database.db),
  authorization: new PostgresCandidate360AuthorizationAdapter(database.db),
  cursorSigningKey: config.cursorSigningKey,
  contentStore: objectStore,
});
```

The API runtime role needs `SELECT` on the scoped CRM/intake metadata, `INSERT` on the audit ledger,
and object-store read access. It must not receive permission to change `scan_state`.
