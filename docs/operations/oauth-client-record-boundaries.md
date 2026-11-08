# BE-12 OAuth client redirect metadata boundary

## Finding and bounded plan

At `ce17d1d`, `PgMcpOAuthRepository.register` and `client` annotate PostgreSQL
JSONB `redirect_uris` as `string[]`. Migration 20261107111130 requires a JSON
array with one to five entries, but does not constrain element types or apply
the application's canonical redirect-URI policy. Normal registration already
validates that policy. A malformed persisted array can nevertheless be echoed
as client metadata or passed to redirect matching without runtime validation.

This is a stored-record correctness boundary, not a demonstrated public-input
authorization bypass. Existing exact redirect matching, S256 PKCE, resource
binding, one-use codes, refresh reuse detection, current membership and consent
remain independent and unchanged.

Use the existing Zod/stored-error convention in the PostgreSQL adapter. Reuse
the existing pure `safeRedirectUri` policy; do not invent a second URI parser or
add a dependency. Decode only the selected client fields. Preserve nullable
absence, current expiry filtering, one-to-five unique URLs, public HTTPS and
canonical HTTP loopback callbacks. Keep TEXT labels as driver strings rather
than imposing a different JavaScript/SQL Unicode length constraint.

Registration must decode before committing, so invalid returned data rolls back.
Do not expose the offending redirect, client name or received JSON through the
fixed stored-data error. Do not read, print or persist an OAuth token to test it.
No SQL/grant/schema/configuration, client metadata contract or provider change.

## Acceptance

- Native repository cases preserve URL order, name, Date expiry and null absence.
- Reject malformed JSON elements, empty/oversized/duplicate arrays and unsafe or
  noncanonical callbacks using the existing URI policy and fixed diagnostics.
- Preserve register transaction rollback/release and no raw value reflection.
- A disposable SQL fixture proves valid JSON driver shape, a constraint-valid
  malformed array, scoped corruption/repair and exact client cleanup.
- Existing OAuth/remote/stdio tests, complete harness, architecture and fresh
  actual SQL/image/UX CI must pass before observed publication of both services.

## Status

Implementation and 23 focused native/HTTP/stdio cases pass locally. Four new
repository cases cover stored arrays/driver shape, current URI rules and
registration rollback/release. One actual SQL corruption/repair case is added
to the disposable database suite. All seven harness checks and both architecture
graphs pass locally (453/1,809 structural modules/dependencies, 452/1,314
runtime). The optional model-performance gate was not executed. Fresh actual
SQL/image/UX CI and publication remain pending. Local Docker is still unavailable
because the existing VM is full; that is not an actual-SQL pass. No dependency
version or lockfile changed.
