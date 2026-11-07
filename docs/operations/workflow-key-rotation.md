# Staged workflow key rotation

Workflow inputs, native checkpoints, pending writes and completed provider
receipts use AES-256-GCM. Tenant, actor, run and record identity are authenticated
associated data. New envelopes also authenticate a format header and key ID.
The active writer key and retained reader keys are separate. Keys never appear
in reports, logs, source control or browser configuration.

## Current activation gate

The 2026-11-07 architecture review found that the current inventory paginates
physical `ctid` values across transactions. Heartbeats/status updates can relocate
a row without changing its old ciphertext, so a concurrent scan may miss it.
Do **not** retire reader keys based solely on this scan's `complete`/`remaining`
report while database writers are active. Stopping only old encryption writers
does not stop status updates.

Complete [BE-01](../technical-backlog.md#be-01--stable-encryption-key-inventory)
with immutable logical-key traversal and concurrent-update tests before online
retirement. An alternative maintenance procedure must quiesce **all writes and
row-relocating maintenance on all four stores**, retain the full reader ring,
and perform complete fresh verification before resuming work. If that cannot be
proven, keep old reader keys. Actual production key activation/retirement has not
been performed by this release. Existing staged happy-path tests do not close
this concurrency gap.

## Compatibility and rollout

1. **Prepare readers.** Deploy the keyring-capable code to every API/worker while
   retaining `WORKFLOW_STATE_KEY`. With only that legacy setting, writers still
   use the old format, allowing safe rollout before changing writers.
2. **Prepare custody.** Create a new canonical base64 32-byte key in the secret
   system. Preserve old keys in controlled escrow for the full backup/restore
   retention period. Document who can restore them. Do not paste keys in chats.
3. **Switch writers.** Configure `WORKFLOW_STATE_KEYS` as a JSON object of key IDs
   to base64 keys and `WORKFLOW_STATE_ACTIVE_KEY_ID`, keeping the old legacy key
   available for reads. For later rotations retain the prior named keys in the
   JSON ring. All old writers must be stopped/upgraded before verification.
4. **Inventory.** First satisfy the activation gate above. Run
   `npm run workflow:keys -- --dry-run`. Reports contain only
   key IDs, scanned counts and completeness, never decrypted values.
5. **Reencrypt.** Run `npm run workflow:keys -- --apply` in a controlled trusted
   process. It uses bounded transactions, lock/statement timeouts, authenticated
   decrypt/re-encrypt/verify and compare-and-update. It covers all four stores.
6. **Verify again.** Repeat a fresh dry run after all writers use the new active
   key. Require both `complete: true` and `remaining: 0`. The verification also
   authenticates records already carrying the active key ID. Exit 2 means an
   incomplete bounded scan, not permission to retire a key. Repeat bounded apply
   passes as needed. Apply scans skip already-active envelope prefixes so another
   bounded invocation progresses beyond previously converted rows. A full dry
   inventory must still authenticate all active records. For larger inventories,
   use `--batch-size 200 --max-batches 1000` within an appropriate maintenance
   window; do not infer completion from the number of changed rows.
7. **Rehearse restore.** Restore a retained backup in isolation, supply its
   required reader keys and complete a resumed workflow. Unit/real PostgreSQL
   tests verify old/new readers, tenant authentication, all stores, bounded
   progress, tamper failure and reading after online retirement. This is not
   evidence that a real production backup has been restored.
8. **Retire online readers.** Only after the concurrency gate, complete
   verification and restore readiness remove inactive keys from the running
   service. Keep escrow copies
   until every backup, archive and retained encrypted record needing them expires.

## Failure and rollback

Stop immediately on an unreadable/authentication-failing row, unavailable key,
lock timeout or incomplete inventory. A failed batch rolls back; previous
committed batches remain readable with the full ring. Keep every reader key and
resume investigation without printing ciphertext or plaintext. Do not delete
unreadable runs merely to make the inventory pass.

Before activation, rollback can restore legacy writers. After any versioned
writes, rollback must use a versioned-reader-capable release with all keys. Do
not redeploy a legacy-only reader. A suspected key compromise requires a separate
incident review of exposed data and backup custody, not just changing key IDs.

The code deploy does not itself rotate the production secret. Actual key
creation/custody, staged writer activation and a target-environment restore
rehearsal remain operational activation work.
