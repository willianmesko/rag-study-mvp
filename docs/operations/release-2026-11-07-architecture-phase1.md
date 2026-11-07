# Architecture phase 1 and MCP compatibility release

Application source: `a59036044e19a4f35d38e4df8c8c18c7573de646`, including
architecture commit `f4ec388`. Previous verified release: `e25572d`.

## Delivery scope

The [technical backlog](../technical-backlog.md) now records six implemented
tickets, two partial tickets and 17 pending tickets. This is the first
incremental implementation, not completion of the architecture roadmap.

- **BE-01:** immutable logical-key inventory and conditional ciphertext updates,
  tested across all four encrypted stores under tuple relocation, heap rewrite,
  process loss, bounded resume and reader-key retirement. Negative controls
  reproduced missed records in the older implementation.
- **BE-02:** safe native JSON/MIME/body/rate-limit error responses, real multipart
  limit handling and unique-slug-only conflict classification. Unknown dependency
  errors remain sanitized. Real Fetch-to-Fastify tests cover owner role changes.
- **BE-04:** bounded repair discovery covers the full 30-day ledger window,
  including a restart after 25h without a new call; concurrent pagination and
  unique outbox identity are verified.
- **BE-05:** a required CI job executes the existing embedding-index cutover
  suite in its own disposable database, failing instead of silently skipping
  required fixture configuration. Index invariants and rollback remain tested.
- **FE-01:** user/workspace query keys contain no credentials. Auth boundaries
  abort/remove private reads and reset scope; same-user token refresh retains
  valid cache identity. Durable server runs are not silently cancelled.
- **FE-03:** section-level recovery preserves navigation, sanitizes diagnostics
  and supports explicit retry/reload for render or module-download failure.
- **Partial BE-03/FE-02:** idle-pool faults are handled with content-free
  metrics/logging; JSON void requests send the correct header; API/upload/SSE
  errors retain safe reason codes. SQL workload limits and complete success-body
  Zod migration remain pending.

The additional MCP change ignores unknown OAuth extension parameters and empty
values while preserving required S256, exact resource/client/redirect binding
and explicit workspace consent. Standard MCP server information exposes the
Lumora title, description, configured website and public 256×256 PNG icon.
The exact reported ChatGPT authorization request and a real completed third-party
connection were not supplied/established by these automated checks.

## Verification

[GitHub Actions run 42389555482](https://github.com/willianmesko/rag-study-mvp/actions/runs/42389555482)
completed successfully for the source SHA above: `verify`, `mcp-isolation`,
`embedding-index-cutover` and `ux`. The cutover job ran one test with zero skips;
the full CI browser run passed 163 cases with 44 intentional profile skips.

Local evidence:

- Quality/evaluation harness passed: compilation, builds, unit tests, golden
  retrieval, injection/replay regressions and Promptfoo. The optional live
  latency/cost gate remains inactive without reviewed measurements.
- **62 actual PostgreSQL integration checks passed, zero skips**, plus the
  isolated embedding cutover suite. Five negative fixture guards fail before
  accessing a shared/remote or missing database.
- **160 full responsive browser cases passed, 44 intentional profile skips**,
  followed by **three additional module-download/reload recovery cases**, one
  per viewport/locale. Existing screenshot baselines were unchanged. Earlier Mac
  screenshot differences were checked against the authoritative Linux environment.
- Focused HTTP tests exercise actual JSON/multipart parsers, HTTP rate limiting,
  safe conflict classification and an authenticated role PATCH. OAuth tests
  reject missing PKCE, changed audience/redirect and extra permissions.
- The local main entry is 622,929 raw / 191,442 gzip bytes, versus the dated
  baseline's 620,373 / 191,142: 300 additional gzip bytes. This is a local artifact
  measurement, not a Lighthouse/field-performance or throughput claim.

No runtime dependency, lockfile, live database schema, provider key or hosting
plan changed. Providers/mail are simulated in routine tests. The new CI database
is disposable; native OCR image checks remain part of the existing API build.

## Production verification

Both Render deployments were verified **live** at the exact source SHA:

| Surface | Deployment | Completed, UTC |
| --- | --- | --- |
| [Frontend](https://rag-study-demo-web-4ae2.onrender.com) | `dep-dbnkr6ec6qcc73e62u20` | 2026-11-07 16:11:54 |
| [API](https://rag-study-demo-api-4ae2.onrender.com/health) | `dep-dbnkr5e417fc73e1o2q0` | 2026-11-07 16:13:01 |

Post-live verification confirmed frontend HTTP 200 and the new safe diagnostics/
section recovery code in the served entry; the public PNG is image/png, 256×256,
and byte-identical to the source. API health is 200; a server-generated request ID
replaces a client-selected value. Resource discovery advertises Lumora and S256.
Unauthenticated MCP/alerts/conversation reads return 401. Malformed JSON and XML
at the OAuth token endpoint return 400/415 without creating a grant; a bare
authorization request is rejected with the resource requirement. No runtime
error/fatal log appeared in the inspected post-live window.

The services use public Git repository URL deployment; no automatic deploy
appeared for this push. Both manual deploys were started only after all four CI
jobs passed, despite the legacy `autoDeploy` flag shown in metadata. This
source-mode limitation is documented in
[Render deploy behavior](https://render.com/docs/deploys#automatic-deploys).
No provider, email, private document or real third-party consent was exercised
by the smoke checks. Later documentation-only commits do not imply a new runtime
release.

## Activation and rollback boundaries

Key creation/rotation, retained backup restore, a real budget receiver, paid
reranker/embedding migration and real external assistant consent remain separate
operational work. Use the updated logical-key inventory, switch all encryption
writers, then perform fresh verification before retiring readers. An icon's
appearance depends on client support for MCP implementation icons.

The previous application can be redeployed without a schema rollback because
this batch adds no migration. Reconfirm compatibility before rollback if an
operator later changes keys or an external index. Retain the
[rotation](workflow-key-rotation.md) and [delivery](integration-recovery.md)
runbooks; do not clear uncertain provider effects to force recovery.
