# BE-12 configuration and stored-record increment

## Status

The bounded increment is **published on frontend and API** at `2e6a4281fecb8fa55d6aa69e589d48a62999599a` after
all four [exact-source gates](https://github.com/willianmesko/rag-study-mvp/actions/runs/42421393271) passed. BE-12 remains **partial**: not every
repository, provider transport or older singleton-based fixture is migrated.
FE-11 is included in this same verified runtime. The previous runtime was `d63a4b1`.

## Delivered

- Pure environment parsing preserves the existing schema, defaults and guards.
  Root server/CLI composition supplies explicit typed configuration; module
  factories keep their existing technology-neutral options and ports.
- HTTP construction accepts a typed subset and production policy. CORS and
  anonymous hashing use that same instance. Existing optional callers remain
  compatible; the production server supplies its settings explicitly.
- Evaluation rows decode actual numeric/Date/JSON representations and explicitly
  reject missing insert rows. Nullable unknown metrics remain null. Fenced
  paths decode before commit.
- Semantic-cache rows decode finite similarity and bounded citation records
  before returning an answer. Model/workspace/expiry and revision predicates,
  timeouts, read-only transactions and cancellation remain unchanged.
- A fixed stored-record error retains no row, parser issues or raw cause.
  Corruption produces a sanitized server failure rather than fake measurements,
  an invalid reused answer or an implicit additional paid-provider call.

See the [configuration/record guide](../backend-configuration-and-records.md) for
locations, ownership, trade-offs, validation and remaining scope.

## Validation

Nine focused unit cases passed for parsing, two independent HTTP instances,
missing/invalid metrics, safe errors and cache records. Two new real PostgreSQL
cases verify actual decimal/null/Date/JSON behavior, model/workspace isolation,
malformed stored records and connection reuse. The complete PostgreSQL suite
passed **85 checks with zero skips**, and the isolated embedding cutover passed
**one case with zero skips**. All seven local evaluation-harness checks passed.

The source dependency graphs have zero violations: **448 structural modules /
1,761 edges**, **447 runtime / 1,267**. All 78 architecture fixtures, the complete UX suite, native route-state/payload cases and both database jobs subsequently passed in CI.

No dependency, migration, credential, grant, environment setting, model price,
provider policy or screenshot baseline changed. Tests use synthetic data and a
disposable local database; no paid provider or real email was used.

## Exact-source CI and production

Frontend and API are **live at `2e6a4281fecb8fa55d6aa69e589d48a62999599a`**, after all four
[release gates](https://github.com/willianmesko/rag-study-mvp/actions/runs/42421393271) passed. The source skipped automatic publication; fresh
remote-head/queue checks preceded the manual triggers. Both records match the
same source.

| Service | Deployment | Observed live at UTC |
| --- | --- | --- |
| API | `dep-dbnqjkm417fc73efp330` | 2026-11-07 22:46:39 |
| Frontend | `dep-dbnqjlqjnfac73d3sem0` | 2026-11-07 22:45:28 |

CI passed **410 UX-suite checks / 46 intentional profile skips**, **85 PostgreSQL
checks / zero skips**, the isolated cutover / zero skips, all 78 architecture
fixtures, the seven-check harness, four native route-state cases and three
frontend-budget cases. Both production dependency graphs remained clean. Build
and browser measurement artifacts uploaded successfully.

The CI default build measured gzip entry 125,974 bytes, all JavaScript 260,331,
CSS 14,317 and largest chunk 125,974, with no budget failure or exception. These
are payload measurements, not field LCP or a claimed provider speedup.

Public checks at **22:48:00 UTC** confirmed frontend 200, entry
`/assets/index-B-Qgg-J_.js`, application chunk
`/assets/WorkspaceSwitcher-OP4Wzwjj.js`, semantic stylesheet
`/assets/index-CS2-Q0PU.css` and the unchanged original 256-pixel icon bytes.
API health returned 200 with OCR/durable workflows/conversations enabled and a
server-owned correlation ID. Private MCP, conversations and administrative alerts
returned 401. OAuth resource/S256 discovery and sanitized malformed JSON 400,
unsupported XML 415 and missing-parameter rejection remained intact.

The API error/fatal query for **22:46:39–22:48:23 UTC** returned no records. This
is a bounded inspection. These public checks did not access real private user
data, invoke a paid provider, send email or complete third-party consent.
Authorized flows are covered by synthetic browser and isolated database suites.

## Rollback

Restore the preceding application source as one consistent release. There is no
schema or environment rollback. Legacy settings loading and HTTP call signatures
remain compatible; explicit composition call sites are part of this change.
