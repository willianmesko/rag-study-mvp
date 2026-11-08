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

Implementation and local validation are complete; fresh CI/publication remain
pending. The new synthetic regression failed in two cases before the fix: a
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
