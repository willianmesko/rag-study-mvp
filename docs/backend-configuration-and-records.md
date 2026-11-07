# Explicit configuration and checked stored records

This BE-12 increment keeps the existing module factories, Fastify, pg and Zod.
It introduces no dependency, environment variable or schema migration.

## Concrete changes and trade-offs

| Observed boundary | Change | Benefit and cost |
| --- | --- | --- |
| `config.ts` parses the process environment when imported; tests override its shared object | Move the unchanged schema and guards into pure `app/configuration/environment.ts` | Isolated inputs can be validated without loading `.env` or mutating process state; the small compatibility entry point remains for existing server/CLI consumers |
| Root assembly implicitly reads the singleton | `createApplication(configuration)` requires an explicit typed configuration; server and both CLI callers supply it | Configuration ownership is visible at composition; feature modules retain their existing domain options/ports |
| CORS, anonymous actor hashing and production policy close over global settings | `buildApp` accepts a typed HTTP subset and production policy; helper functions use that same instance | Concurrent instances can use different keys/origins/scopes without borrowing each other's settings; the old optional fallback remains compatible |
| Evaluation metrics use unchecked numeric conversion and an asserted insert row | Decode physical rows with Zod, real decimal ratios, nullable unknown measurements and a checked missing-row failure | No `null`/empty-string-to-zero or NaN measurement; decoding adds bounded CPU work and a corrupt record becomes a sanitized server failure |
| Semantic-cache JSON is asserted to be citations; NaN can bypass a comparison | Decode bounded citation records and finite similarity before returning a cached answer | Invalid stored data cannot become a reused answer; corruption fails closed rather than silently invoking a paid model |

This is not an ORM, validation framework or dependency-injection container.
`decodeStoredRecord` is a small shared error-sanitizing wrapper around the existing
Zod parser, used by two concrete adapters. Its fixed error has no stored value,
validation issues or raw cause. HTTP treats it as a server failure rather than
mistaking a database defect for invalid client input.

## Ownership and compatibility

`RuntimeConfiguration` is inferred from the existing environment schema.
Composition projects it into the existing provider/workflow/module options.
No feature factory receives a PostgreSQL or provider SDK through these types.
The compatibility module still loads the root `.env` at the same location and
preserves defaults and cross-field guards. Deployment settings remain unchanged.
The production server supplies its parsed configuration and production flag
explicitly. No settings are serialized to a public endpoint.

The HTTP compatibility fallback and some older tests still use the existing
singleton. Provider transport deadlines also still read it. Completing that
migration is separate remaining work; this increment does not claim that every
process-global configuration read is gone or that settings are deeply immutable.

## Database boundary

Wire DTOs and physical rows remain distinct. Evaluation `numeric` ratios accept
finite numbers or PostgreSQL decimal strings in [0,1]. Unknown faithfulness/context
precision stays `null`. `created_at` must be a real driver Date; JSON metadata must
be an object. A missing `INSERT ... RETURNING` row is checked instead of asserted.
Fenced evaluation paths decode before committing. SQL bindings and fencing remain.

Cached citations require UUIDs, typed passage fields, nonnegative integer ordinals
and at most 20 sources. Unknown fields are discarded; previews still use the
existing redaction/size policy. Reads retain workspace/model/expiry predicates,
read-only bounded transactions, cancellation and embedding revision locks.
The decoder does not replace server authorization or verify a claim's factual
truth. Other repository families still require their own boundary inventory.

## Objective checks

- Pure configuration cases preserve defaults, independent model/origin arrays,
  provider prerequisites, fixed vector dimensions, chunk limits and workflow keys.
- Two HTTP instances exercise distinct keys, CORS, OCR capability, production
  authorization and hashed anonymous identity without global overrides.
- Unit cases reject missing insert rows, invalid decimal/null/NaN data, malformed
  cached passages and excessive sources without reflecting stored sentinels.
- Disposable PostgreSQL cases verify actual numeric/Date/JSON behavior, workspace
  and model isolation, corruption failures and connection reuse.
- Existing API, pgvector cutover, architecture, evaluation harness and UX gates
  remain publication requirements. No paid provider, real email or production
  credential is required for these checks.

Reference behavior: [node-postgres data types](https://node-postgres.com/features/types)
and [parameterized queries](https://node-postgres.com/features/queries).

Rollback restores the prior application source; no database or environment
rollback is required. Sanitized failures intentionally need diagnosis/repair of
corrupt records rather than a fictional metric or unvalidated cached response.
