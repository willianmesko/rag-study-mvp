# Prisma audit-event release

## Source and gates

- Implementation: `ff39a8155af8324d623df37888070e74c4b8a462`.
- Merged source: `1d451f7e6918300f3771d7156a90093965a74f36`.
- Both trees: `2365fb18c7c4a17a5616b0f55c7431be55060099`.
- [Pull request](https://github.com/willianmesko/rag-study-mvp/pull/3).
- [All four passing quality gates](https://github.com/willianmesko/rag-study-mvp/actions/runs/43260578081).

## Delivered scope

The existing audit-event port now uses Prisma in the API through Nest's
`AUDIT_EVENTS` binding. The partial schema maps existing SQL defaults/columns;
there is no DDL, new grant, package upgrade or additional runtime pool. SQL
migrations, RLS and tenant foreign keys remain authoritative. Legacy SQL remains
available for standalone composition and rollback. No HTTP, authorization, chat,
MCP or business audit contract changes.

This is the second of 18 named repositories migrated in the API. Sixteen named
repositories plus six specialized PostgreSQL adapters remain SQL; the ten-module
Nest migration is already complete. See the [inventory](../prisma-migration-inventory.md).
Some vector, lease, fence and checkpoint operations may appropriately retain SQL.

## Acceptance evidence

- Both required Prisma integrations pass without skips. Real Nest policy edits
  and conversation creation append the expected audit events through Prisma.
- Owner/viewer/non-member behavior, concurrent workspace-bound writes, legacy SQL
  JSON/null/Unicode equivalence, generated defaults, FK and RLS are preserved.
- A live restricted-role connection cannot insert audit rows. A local-only database
  constraint failure returns a sanitized 500 instead of a successful audit result.
- Existing business writes and audits remain separate operations. Failure after a
  business write does not newly roll it back; transactional outbox redesign is
  outside this adapter migration.
- All 100 existing PostgreSQL cases and seven evaluation harness checks pass.
  Strict API/web types and structural/runtime graphs pass. Fresh CI also covers
  architecture fixtures, index cutover, minimal MCP image, alarms and UI regression.
- The candidate API image passes two native OCR cases, health 200, private access
  401, preserved 404 and clean SIGTERM exit 0. CI builds the exact merged tree.
- Benchmark appends 588 synthetic records, checks one Prisma statement per append,
  no extra runtime pool and the two-connection ceiling. CI exports fresh results
  as a required artifact; latency is evidence, not a noisy universal timing gate.

## Cost and contention limits

[Local measurements](benchmarks/prisma-audit-local-2026-11-12.json) compare equal
pools and the actual mixed topology. With four concurrent audit writes and one
policy lookup, audit p95 is 3.982ms before vs 4.161ms after; policy-read p95 is
2.437ms before vs 5.188ms after. Moving audit from primary(10) to shared Prisma(2)
adds possible queueing. This bounded demo trade-off is explicit, not a speedup
claim. Local ARM host/x86 Docker noise and outliers are retained in the report.

No paid AI call is needed. These tests do not certify Supabase/Render capacity;
a hosted mixed-load/pool-wait exercise remains necessary before scale-up or
migration of a high-volume ledger. Do not backfill hypothetical usage/cost data.

## Production status

Render API deploy `dep-dbquqfutlv9c739kgbs0` confirmed **live** at
`2026-11-12T16:48:31Z` (13:48 in São Paulo), with exact merged source `1d451f7`.

After activation, public checks passed: health 200 with OCR/durable workflows/
conversations enabled; private model-policy/workspace/conversation/document/model
reads 401 without credentials; OAuth metadata 200 with the expected issuer;
remote MCP challenge 401; invalid OAuth request 400; frontend CORS preflight 204;
preserved 404; existing frontend HTML 200. No frontend code/deploy was required.

The connected Lumora MCP client completed authenticated owner-only
`get_quality_report(limit: 1)` after activation and returned structured `runs`
without an error. This read traverses the mandatory audited tool path: a failed
audit would withhold the successful result. No private document contents were
read and no LLM/provider generation was requested. The connector first requested
and accepted authentication; its instructed retry succeeded. Credentials and
returned evaluation contents are not included in this receipt.

Bounded post-activation error and duplicate-reply log queries returned no matching
entries. This observation window is not a long-term reliability or load claim.

Rollback target before this release: API deploy `dep-dbquc3lg1s2s73888970` at
`448c91e`. Its SQL audit adapter reads the same table. Use a retained compatible
image and verify current environment/state; rollback does not reverse audit or
business effects. No database schema rollback is needed for this change.
