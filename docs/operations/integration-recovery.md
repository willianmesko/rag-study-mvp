# Integration delivery and recovery runbook

## Guarantees and boundaries

| Effect | Identity and admission | Retry policy | Uncertain outcome |
| --- | --- | --- | --- |
| File upload | Workspace + authenticated actor + opaque key + request fingerprint; byte quota, job and queued event commit together | Repeat the same key and identical content | Stable private object path; verify existing bytes; never delete an original after an unknown database commit |
| Ingestion admission | Existing job ID is the workflow ID | Bounded delayed admission; active workflows are not readmitted; failed jobs need an explicit retry | Check current workflow/lease and original before retry |
| Model/embedding/judge/rerank call | Tenant/run + immutable effect fingerprint + attempt receipt | Up to three rejected 429 attempts under one deadline; each extra request consumes call budget | Hold ambiguous paid calls; never promise provider-side exactly-once |
| Budget webhook | One workspace + UTC day + threshold; immutable delivery UUID | Jittered backoff; numeric/date Retry-After; at most eight attempts per replay cycle | At-least-once transport; receiver deduplicates the stable delivery UUID |
| Future external writes | Disabled | No executor is registered | Requires the effect-specific policy below before enabling |

No protocol can atomically commit a provider's network action and our database.
The local journal avoids repeating a completed effect; it cannot prove whether
a remote service accepted a request when the connection disappeared. Do not
clear uncertain receipts to make a retry pass.

## Uploads and ingestion

Clients may send `Idempotency-Key` (16–128 letters/digits/underscore/hyphen).
Scope includes workspace and actor. Reusing a key for different input returns
409. Without a key, the byte/metadata fingerprint deduplicates identical uploads
for that actor. To intentionally process the same source again use reindex/retry.
A changed URL response is different input; the current endpoint still fetches
and validates the page before upload admission. It is a snapshot import, not a
URL-subscription or exactly-once downloader.

The private original uses a stable actor-scoped request path. Repeated storage
acceptance verifies content instead of overwriting. A crash before job admission
can leave an unreferenced object; keep it for a retry and use a separately reviewed
reference/age-based cleanup later. Never delete an object merely because a
request returned an error.

Admission retries are delayed and capped. Stale processing is reclaimable only
without an active linked workflow. Execution leases use fencing: a stopped or
replaced worker cannot publish a completed result. A manual failed-job retry
preserves completed nodes and receipts. An ambiguous receipt can still stop it;
this is an intentional protection against another paid invocation.

## Unknown provider outcome

1. Inspect safe workflow events, run ID, provider operation and reason. Never
   export the encrypted request or raw prompt to a log or support ticket.
2. Check the provider's authorized usage dashboard/request records. Classify the
   outcome as delivered, rejected before work, or unresolved. Retain evidence in
   the incident record with permitted identifiers only.
3. If delivery is unresolved, keep the run failed with `effect_outcome_unknown`.
   Create a new explicit user request only after explaining possible additional
   cost. There is no CLI command that silently clears this safety hold.
4. If a future operator reconciliation command is added, require owner/operator
   authorization, exact record version, duplicate-charge acknowledgement and an
   append-only audit. Never accept a model's claim of non-delivery as evidence.

## Budget notification delivery

Configure `BUDGET_ALERT_WEBHOOK_URL`, `BUDGET_ALERT_WEBHOOK_SECRET` (at least 32
characters) and `USAGE_ALERT_THRESHOLD_USD`. No destination is active by default.
The threshold covers known reported/estimated cost over 30 days. Unknown-price
operations are included as a count. The ledger and queued entries survive
restarts. [BE-04](../technical-backlog.md#be-04--complete-budget-alert-repair-window)
extends bounded repair discovery to the same 30-day accounting window, keeping
100-tenant keyset pagination and unique delivery identities. Actual PostgreSQL
tests cover a crash-gap receipt discovered after 25h with no new provider call,
concurrent scans over more than 100 tenants and stable deduplication. Use a
release containing that fix before unattended activation; older one-day repair
can miss this case. Delivery remains at least once, not provider-side exactly
once. Configure and verify a real receiver separately.

The server chooses the HTTPS destination. DNS is resolved and public IPv4
addresses vetted; the socket pins a validated address with hostname TLS/SNI
verification. There are no redirects or ambient proxy reuse. A three-second
per-attempt deadline and 8 KiB fixed payload bound the call. The destination,
credentials and response body never appear in event records.

Validate `x-lumora-signature` as HMAC-SHA256 over
`x-lumora-timestamp + "." + exact_request_body`, using a constant-time comparison.
Reject stale timestamps (for example, outside five minutes), then deduplicate
`Idempotency-Key`, which equals payload `id`. Commit the receiver's dedupe record
and business effect together. Retry acknowledgements return 2xx without a
second effect. Keep dedupe records for at least the sender's 90-day retention
and incident replay window. A lost 2xx can cause another transport attempt.

- 2xx: delivered.
- 408, 429, 5xx or network failure: jittered backoff, honoring Retry-After.
- Other status, including redirects and authentication rejection: dead letter.
- Expired delivery lease: another worker can reclaim the same UUID.
- Eight exhausted attempts: dead letter, no unbounded loop.

### Inspect and replay

The owner-only `/v1/admin/alerts` returns safe status/counts and recent IDs.
`POST /v1/admin/alerts/:id/replay` requires an explicit workspace, current owner,
`Idempotency-Key` and `{ "expectedAttempts": 8 }` matching the current record.
Only dead letters can be replayed. A stale state returns 409. Repeating a command
key does not reset attempts again. Replay retains the delivery UUID and records
the actor, previous attempt count and reason.

Trusted operators can use the equivalent CLI. Examples below use shell
variables for identifiers; they do not contain credentials.

```bash
npm run integration:deliveries -- --workspace "$WORKSPACE_ID" --actor "$OWNER_ID"
# Fix destination/access problems, verify receiver deduplication, then explicitly replay.
npm run integration:deliveries -- --workspace "$WORKSPACE_ID" --actor "$OWNER_ID" \
  --id "$DELIVERY_ID" --expected-attempts 8 --key "$REPLAY_COMMAND_KEY" --apply
```

This CLI requires an existing owner's database membership. It uses the trusted
operator database connection, not a public unauthenticated endpoint. Replays
can retry a partially delivered notification; they never authorize a new tool
or bypass the receiver's idempotency requirement. Delivery records/events expire
after 90 days; longer incident evidence belongs in an approved restricted store.

## Before enabling any external write tool

The currently exposed MCP tools remain read-only. A document or model cannot
choose a new destination, obtain credentials or enable a write executor.
A future effect must have a reviewed definition covering:

1. A fixed tool/action ID, strict Zod input/output, current workspace membership,
   effect-specific role and resource permissions, checked again before commit.
2. A durable approval bound to tenant, actor, exact arguments/hash, policy
   version, budget, destination and expiry. Material changes invalidate approval.
   A proposal is distinct from authorization; the model cannot approve itself.
3. A separately hosted, least-privilege isolated executor: read-only root,
   workspace-scoped temporary input, no host mounts, no inherited service-role or
   cloud credentials, bounded CPU/memory/processes, deadlines and cancellation.
   The existing fixed evaluation worker is not general-purpose write isolation.
4. An explicit network destination/method/path allowlist with DNS/IP validation,
   no private/metadata egress or redirects, and narrowly scoped credentials.
   Operating-system/network enforcement is required, beyond model instructions.
5. An effect-specific idempotency key and request hash, transactional outbox,
   fenced lease, retry/permanent/unknown classification, rate-limit handling,
   bounded attempts/spend and a dead-letter/reconciliation path.
6. A replayable append-only audit of proposal, approval, attempts, safe provider
   receipt, final outcome and operator recovery, with a content/retention policy.
7. Tests for revoked permission/approval, altered arguments, stale state, duplicate
   requests, worker crash, unknown remote acceptance, cancellation, egress escape
   and tenant separation. A verified rollback/incident runbook is required.

Possible future examples have different permissions: sending email requires
recipient/draft approval; updating a ticket requires project/field scope; writing
to a drive requires a specific destination; executing arbitrary SQL/shell stays
prohibited. None is enabled by this delivery.

## Workspace invitation delivery

The existing owner invitation action also uses an idempotent journal. The
browser retains one opaque key while retrying unchanged recipient/role input;
server fallback fingerprints scope older clients. Concurrent owners cannot
send the same unresolved recipient invitation in parallel. Completed delivery,
membership, invitation record and safe audit commit together; a lost HTTP
acknowledgement can return the saved result.

Supabase Auth delivery is deadline-bounded. Rejected rate limits have capped,
delayed retries; permanent rejections stop. An unknown send or expired in-flight
lease is held as `ambiguous`, not sent again. The owner must be current both
before sending and before membership commit. Replays cannot escalate an existing
recipient's role. Cached success is rejected as stale if that membership has
subsequently been removed.

Owners can inspect `GET /v1/workspaces/:workspaceId/invitation-deliveries` with
an explicit matching workspace header. This is a private product record and may
contain the intended recipient address; operational logs, metrics and audit
metadata omit it. Delivery journal retention is 90 days. The existing workspace
invitation record follows its seven-day acceptance policy. Sending a real email
still requires configured Supabase Auth email delivery; tests use a synthetic
transport and do not establish real mailbox delivery.

There is intentionally no automatic replay command for ambiguous emails:
Supabase's invite endpoint does not provide an application-controlled delivery
idempotency receipt that proves remote non-delivery. Review the Auth/sender
record first; do not clear a hold on the model's advice. General external
notification tools remain subject to the write-effect prerequisites above.
