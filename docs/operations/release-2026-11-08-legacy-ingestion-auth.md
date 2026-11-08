# BE-16 production authentication for legacy JSON ingestion

## Finding and decision

The production query resolver requires a session when DEMO_MODE and API_KEY are
both absent. The older POST /v1/documents handler instead checks ADMIN_API_KEY
only in demo mode. With a private production configuration and no global API key,
it can otherwise reach quota/ingestion in the default tenant without verifying a
session. This is a concrete configuration-dependent route gap, not evidence of
an incident or a claim that the current hosted demo uses that configuration.

Keep local study execution and the existing global API-key flow. In production,
the legacy route must require a configured matching admin key whenever the
global API key is absent; the existing demo rule remains. A missing configured
key must fail closed. Apply the check before request schema, quota, model or
document work. Signed-in product users continue using the existing RBAC-scoped
workspace upload route; a bearer token alone does not grant the global/default
corpus maintenance capability.

Pass the production policy explicitly from HTTP composition to the controller.
Use the existing constant-time key comparison; add no authentication dependency
or environment field. Regression cases must cover local, public demo, private
production, configured/missing/wrong admin key, existing global key and a forged
bearer/workspace header. Rejected requests must make zero quota, ingestion and
audit calls. Use synthetic dependencies; do not submit a valid document to the
public deployment as a test.

## Status

Implementation, validation and publication are complete at
`c8452e12240c8031733ac59a13f714568b79bd1d`. The new synthetic regression failed in two cases before the fix: a
private anonymous write returned 201, and a missing key reached schema validation
(400). After the fix, all six new route cases and 11 related parsing/private-scope
cases pass (17 focused cases, zero skips). The complete seven-check local harness
passes after explicitly updating the narrow-controller fixture's test policy.
No raw secret or private record enters diagnostics.

The current hosted demo was separately checked with an empty unauthenticated
request at 01:53:58 UTC; it returned 401. No valid document, quota/model admission
or hosted configuration change was used to verify the live demo. This does not
prove every possible deployment configuration safe without the fix.

Production private clients formerly relying on uncredentialed legacy writes
must provide the server-configured maintenance key or use the existing
membership/RBAC upload route. Do not disable authentication to restore that
unsupported access. Local study/default binding, public demo, valid global-key
and credentialed maintenance flows retain their behavior. The product browser
never receives a maintenance key. This separate P1 follow-up (BE-16) is not a
complete re-audit of every route.

## Published evidence

All four [quality gates](https://github.com/willianmesko/rag-study-mvp/actions/runs/42436598494)
passed: 410 UX cases/46 deliberate profile skips, 90 actual PostgreSQL cases
without skips, the isolated cutover, 78 architecture fixtures, seven harness
checks, four native route-state, six artifact, eight capacity-fixture and three
payload cases. The separate exact-source [capacity pilot](https://github.com/willianmesko/rag-study-mvp/actions/runs/42436598528)
passed 104 scoped pairs, all six deduplicated ingestions and clean process exits.
Both dependency graphs passed (450 structural/1,786 edges; 449 runtime/1,293).
The actual API image applied 31 migrations and repeated zero against its own
fixture. Native OCR passed twice with zero skips, and both CI and the actual
Render build reported 490 files/1,549,859 bytes, 14 entry roots, zero project test
artifacts and the unchanged reviewed 31-file SQL catalog digest.

Both services were observed LIVE at the exact source on 2026-11-08:

- API `dep-dbntidff3r2c739k5qo0`: 02:08:43.891300 UTC.
- Web `dep-dbntienf3r2c739k5t9g`: 02:07:40.257665 UTC.

The public check at 02:09:24 UTC verified entry/lazy/CSS assets, original icon
bytes, health/readiness, correlation, protected routes, discovery and safe malformed
requests. An empty unauthenticated legacy write returned 401; no document,
quota/model admission, private question, hosted SQL or secret was used.

The first error-log query returned Render/Loki 503. A repeated bounded query
succeeded and found no error/fatal events in 02:08:43–02:09:59 UTC. The unavailable
attempt is not counted as a clean result. No deploy was repeated to address the
logging service's temporary read failure.
