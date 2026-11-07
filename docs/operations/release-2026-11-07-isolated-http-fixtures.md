# BE-12 explicit HTTP test instances

## Analysis and planned scope

The remaining fixture inventory found 19 test files that mutate imported
`config` fields. Several also change `process.env.NODE_ENV`, then restore global
state in cleanup. This contradicts the newer instance-scoped HTTP composition:
tests can accidentally borrow another fixture's demo/auth policy, and some
exercise a changing configuration object after a server has started.

Migrate four cohesive HTTP families first: query scope/cancellation, knowledge
readiness, demonstration discovery/filtering and workspace isolation. Each
fixture should parse its own synthetic configuration, pass it to `buildApp`
with an explicit production policy and keep existing RBAC/tenant/cancellation
assertions. Compare independently configured public/private instances rather
than changing a running server's demo flag. No real environment, singleton
mutation, additional container or provider call is needed.

Use existing parser/factory APIs and Node tests. This is preferable to another
fixture framework or a broad environment-mocking abstraction. It does not yet
remove legacy casts from unrelated mock ports or migrate all 19 files.

## Acceptance and status

Implementation and local validation are complete; CI/publication are pending.
All 22 existing cases in the four families passed, plus three configuration
isolation cases, with zero skips. Coverage includes actual search disconnect/cancellation, explicit
workspace membership, viewer upload denial, synthetic demo deduplication and
filters. All seven local harness checks subsequently passed, including strict
types, unit tests, build, injection, golden retrieval, replay regression and
Promptfoo. The four files no longer import/mutate `config` or set process
environment. Fifteen other test files still require migration.

The first focused attempt correctly exposed the real parser's demo prerequisite:
the legacy setup had mutated `DEMO_MODE` after parsing and bypassed the required
administrator-key guard. Synthetic demo keys now satisfy that guard; it was not
weakened. A subsequent typecheck caught an incomplete dependency object for the
private comparison instance; both instances now reuse the existing synthetic
dependency fixture while keeping separate configurations. Fresh exact-source CI
and publication evidence are still required. Public behavior and dependencies
remain unchanged; BE-12 stays partial.
