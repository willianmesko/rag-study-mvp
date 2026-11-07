# BE-12 configuration and stored-record increment

## Status

The bounded increment is validated locally; exact-source CI and publication are
pending. BE-12 remains **partial**: this is not a claim that every repository,
provider transport or older singleton-based fixture has been migrated. The prior
verified runtime is `d63a4b1d28bcfd372e79ae6b4475867ad892a708`. FE-11's validated
navigation changes will be published with this increment after all gates pass.

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
1,761 edges**, **447 runtime / 1,267**. CI still requires all 78 architecture
fixtures, the full UX suite, native route-state/payload cases and both database
jobs. No CI requirement is waived because a focused check passed locally.

No dependency, migration, credential, grant, environment setting, model price,
provider policy or screenshot baseline changed. Tests use synthetic data and a
disposable local database; no paid provider or real email was used.

## Rollback

Restore the preceding application source as one consistent release. There is no
schema or environment rollback. Legacy settings loading and HTTP call signatures
remain compatible; explicit composition call sites are part of this change.
