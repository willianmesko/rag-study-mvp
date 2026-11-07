# BE-12 instance-scoped provider deadlines

## Status and scope

The implementation is validated and published at
`92e056e29733846d8d11c6ea8334faee980ae34d`. BE-12 remains partial because older shared-config fixtures and other
repository boundaries still require their own inventory/migration. No dependency,
provider model, price, secret, schema, request field or public response changed.

The concrete remaining defect was `platform/http/provider-client.ts` importing
`config.ts` to obtain its deadline. This made otherwise injected adapters depend
on process state and made unrelated environment parsing part of module loading.

## Implemented boundary

- `createProviderHttpClient` captures a validated immutable timeout per instance.
  Its native `requestJson`, `requestResponse` and signal callbacks use that value.
  A small shared constant preserves the 30-second standalone/environment default.
- Outer provider composition passes the client to Ollama/OpenRouter answer,
  streaming, embedding and judge adapters, and Jina reranking. Bedrock receives
  only the bounded signal callback; its SDK calls/client configuration are
  unchanged. The Jina replay CLI supplies its configured deadline explicitly.
- Constructors retain optional defaults for standalone compatibility. They no
  longer read the application's configuration singleton. Feature factories still
  receive provider-independent ports, not HTTP or vendor SDK objects.
- One composed deadline spans retry/backoff and body consumption. Parent abort
  reasons, byte limits, attempt ceilings and workflow call/cost reservations stay
  enforced. Ambiguous paid failures are not blindly retried. No browser/model
  request may choose a transport or deadline.
- `buildApp` loads its legacy configuration fallback only when no explicit HTTP
  settings are supplied. Server/CLI entry points still validate real environment
  settings; explicit test/embedded instances avoid unrelated `.env` parsing.

The production environment retains its existing 1–120 second validation range;
internal native clients also permit short bounded test deadlines. No production
value was changed. This uses existing fetch/AbortSignal/factories, not another
container, retry library or HTTP client dependency.

## Validation and limits

Ten provider/registry checks passed, including all eleven configured adapter paths
(HTTP and mocked SDK generation/stream/embedding/judge/rerank), independent
instances, caller cancellation, stalled response bodies and deadline exhaustion
during 429 backoff. Oversized bodies and ambiguous/permanent-failure guards remain.
Three explicit HTTP-configuration cases passed, including a child process whose
invalid unrelated environment does not prevent an explicitly configured server
from importing, starting and serving health. Strict API types passed.

All seven local evaluation-harness checks passed for the final lazy-config and
provider variant. Both graphs are clean: 449 structural modules / 1,764 edges,
448 runtime / 1,270. Tests use synthetic bodies and
mock SDK sends; no AWS service, paid provider or real user data is contacted.
The local Docker/database capacity limitation remains documented in the
[runtime-artifact receipt](release-2026-11-07-runtime-artifacts.md); fresh CI is the
complete database/operational proof.

All four [exact-source CI jobs](https://github.com/willianmesko/rag-study-mvp/actions/runs/42424645036)
passed: 410 UX cases with 46 deliberate skips, 85 PostgreSQL cases with no skips,
the isolated embedding cutover, 78 architecture fixtures, seven harness checks,
four native route-state, three artifact and three payload cases. The same CI
also built and exercised the actual restricted MCP image: five read-only tools,
network disabled and an unknown write tool rejected.

Both matching Render records were observed live on 2026-11-07 UTC:

| Service | Deployment | Live time |
| --- | --- | --- |
| API | `dep-dbnr7qajnfac73d5le60` | 23:28:35.985768 |
| Web | `dep-dbnr7rlg1s2s73dfc8cg` | 23:28:25.059466 |

Public checks at 23:30:17 UTC confirmed served frontend assets, icon bytes,
health/OCR/durable capabilities, server correlation IDs, private-route protection
and bounded OAuth input handling. The API error/fatal window from 23:28:35 to
23:30:33 UTC was empty. This does not claim a completed third-party OAuth consent
or a private real-provider question.

Rollback restores the preceding application source; no environment or data
rollback is needed. The unchanged default and optional constructor arguments
preserve existing server/CLI behavior while making configuration ownership explicit.
