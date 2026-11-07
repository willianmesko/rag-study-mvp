# Workspace MCP and approved actions

## Use Lumora from an assistant

Lumora's remote URL connection and local MCP connector let an assistant search one workspace and inspect
its sources. The assistant chooses a registered tool and supplies structured
arguments. The API verifies the credential, current workspace membership, role,
and call allowance before running a bounded query.

```mermaid
sequenceDiagram
  participant Owner as Workspace member
  participant App as Lumora Settings
  participant Host as MCP host
  participant Bridge as Local stdio connector
  participant API as Lumora API
  participant DB as PostgreSQL
  Owner->>App: Create temporary key for this workspace
  App->>API: Supabase session and explicit workspace
  API->>DB: Store credential digest and expiry
  API-->>Owner: Show key once
  Host->>Bridge: search_workspace with a query
  Bridge->>API: Dedicated key and fixed workspace
  API->>DB: Check current membership and consume allowance
  API->>DB: Read-only query with statement timeout
  API->>DB: Record tool name and outcome
  API-->>Bridge: Screened, size-limited result
  Bridge-->>Host: Structured tool result
```

## Connect by URL with OAuth

The public demo's MCP URL is:

```text
https://rag-study-demo-api-4ae2.onrender.com/mcp
```

In an assistant that supports remote MCP, public-client registration, and
authorization code + S256 PKCE, add this server URL. The assistant discovers
Lumora's authorization server and opens the Lumora consent page. Sign in,
select **one workspace**, review the destination origin and read permissions,
then choose **Allow connection**. The app name is supplied by the client and
is explicitly shown as unverified. Quality reports are owner-only and are
unchecked by default. Declining returns `access_denied` to the registered
callback without creating a grant.

Lumora does not send your Supabase JWT, login password or provider key to the
assistant. It issues separate opaque access tokens (10 minutes) and rotating
refresh tokens (up to seven days), bound to the registered client and exact
MCP resource. A grant expires within 30 days and cannot outlive its client
registration. Refreshing cannot widen the approved tools. Reusing a valid
authorization code or a consumed refresh token revokes the token family;
an incorrect PKCE verifier never consumes a code. Codes expire in 60 seconds,
and pending consent requests expire in 10 minutes.

Open the workspace switcher → **Connected assistants** (`/connections`) to
copy the server URL, see your connections for that workspace and revoke one.
All member roles can manage their own grants, even before completing the
Milo guide. An owner does not manage someone else's grants through this page;
removing a membership invalidates that person's access. Access is rechecked
while a tool runs and before releasing its result.

### Server setup

No additional OAuth service, shared OAuth secret or paid infrastructure is
required. Use the existing authenticated API and frontend:

```dotenv
MCP_ENABLED=true
MCP_REMOTE_ENABLED=true
MCP_PUBLIC_URL=https://your-api.example.com/mcp
APP_BASE_URL=https://your-app.example.com
```

`MCP_PUBLIC_URL` must be a canonical HTTPS `/mcp` URL, except for HTTP loopback
development. Configure `ALLOWED_ORIGINS` for the frontend. Native clients
normally send no Origin; browser clients need their exact trusted origin in
`MCP_REMOTE_ALLOWED_ORIGINS`. Host validation uses the configured public host,
ignoring forwarded host values. CORS exposes the MCP challenge/protocol headers.
Serve the frontend with `X-Frame-Options: DENY` (included in `render.yaml`) to
prevent framing the consent screen. The optional legacy global `API_KEY` is
bypassed only for the registered public MCP/OAuth endpoints; normal management
APIs continue to require the normal app session and existing API policy.

Discovery is at `/.well-known/oauth-protected-resource/mcp` and
`/.well-known/oauth-authorization-server`. OAuth endpoints are
`/oauth/register`, `/oauth/authorize`, `/oauth/token` and `/oauth/revoke`.
Token/revocation requests accept URL-encoded forms; duplicate form/query
parameters are rejected. Redirect URLs must match the registered string
exactly, use HTTPS or loopback HTTP, and contain no credentials or fragments.
The authorization callback includes the issuer (`iss`).

The official MCP SDK serves modern `2026-07-28` requests and stateless legacy
`2025` Streamable HTTP. There are no server subscription streams or persistent
MCP sessions; GET and DELETE on `/mcp` return 405 after authentication. Tool
results can use bounded JSON or legacy SSE framing. Notifications can cancel
a running request by ID, scoped to that exact grant; another grant cannot
cancel it. A PostgreSQL execution row coordinates cancellation across API
instances, while local abort signals handle disconnects and shutdown.

Public Dynamic Client Registration is supported for compatible clients.
Client ID Metadata Documents, confidential clients, client-credentials grants
and arbitrary external metadata/logo fetching are not implemented. DCR is an
optional compatibility mechanism in the current MCP authorization specification;
do not claim that every remote client supports it. Test the actual client before
enabling a team-wide integration. Registrations are capped at 1,000 globally,
20 pending requests per client, and 25 active grants per member/workspace
(at most five for the same client), in addition to endpoint rate limits.

```mermaid
sequenceDiagram
  actor Member
  participant Assistant
  participant API as Lumora MCP + OAuth
  participant App as Lumora consent
  participant DB as PostgreSQL
  Assistant->>API: Discover resource and register public client
  Assistant->>API: Authorize with resource, state and S256 challenge
  API-->>Member: Open first-party consent request
  Member->>App: Sign in, select workspace and approved tools
  App->>API: Session JWT + explicit workspace + approval
  API->>DB: Recheck membership, store code digest, audit approval
  API-->>Assistant: Registered callback with code, state and issuer
  Assistant->>API: Exchange code + verifier + matching resource
  API-->>Assistant: Scoped access token + rotating refresh token
  Assistant->>API: MCP tool request with opaque access token
  API->>DB: Check grant, role, rate, budget and cancellation state
  API-->>Assistant: Screened tool result after mandatory audit
```

### Hybrid search and provider budgets

`search_workspace` uses the active `workspace_embedding_versions` identity.
Only the server's configured default embedding identity with its explicit
`EMBEDDING_INPUT_COST_PER_1K_USD` price is enabled for MCP. A missing index or
another/unpriced model fails closed, without pinning an index or invoking a
provider. An operator must activate a correctly priced compatible index through
the existing reindex/migration process. Tool arguments never choose a provider,
model, URL, tenant, SQL expression or filesystem path.

The query is PII-redacted, bounded to 250 characters, and embedded once. Up to
20 vector and 20 text candidates are fused using RRF (`k=60`) before returning
at most five screened excerpts of at most 500 characters. `rank` is the fused
ordering; optional `similarity` is cosine similarity in `[-1,1]`, not a
probability or factual confidence. Document text remains untrusted reference
material even after deterministic screening.

| Default limit | Scope |
| --- | --- |
| 10 MCP requests/minute, 400/day | User and workspace, shared across credentials |
| 100 embedding calls/day, 100,000 reserved input tokens/day | User and workspace |
| USD 0.005 maximum reserved cost/call | One search |
| USD 0.01/day | User in a workspace |
| USD 0.05/day | All MCP searches in a workspace |
| 2 concurrent provider requests | Workspace |
| 2,048 maximum reserved input tokens | Search |
| 8 seconds remote / 5 seconds local API / 2 seconds per SQL statement | Execution |

All daily limits use UTC. The `.env.example` contains the configurable bounds.
Budgets are atomically reserved in PostgreSQL before the outbound call using a
conservative UTF-8 token upper bound plus overhead, and the server-owned price.
This is estimated spend accounting, not provider-reported billing. Failed and
cancelled attempts retain their reservation because the provider may have
already billed them. Finishing releases only the concurrency slot. Neither
rotating a token nor registering another assistant resets the user/workspace
counters. Removing and re-adding a member also retains already-consumed usage;
membership deletion revokes grants without refunding paid attempts. A
per-workspace lock prevents concurrent budget overspend. Remote
cancellation is polled every 250 ms and propagated to provider/SQL abort signals;
cancellation cannot reverse work already billed upstream.

Only this search uses an AI provider. These tools never call a chat model,
rewrite queries, fall back to a second provider, run evaluations or rerank.
Read-only means business documents cannot be modified; authorization,
accounting, cancellation and mandatory audit records are intentionally written
through a separate control connection.

### Operational checks and limits

The local integration suite uses a disposable PostgreSQL database and a fake
embedding adapter, with real MCP SDK clients and real HTTP/database transactions:

```sh
DATABASE_URL=postgresql://rag:rag@127.0.0.1:5432/rag \
MCP_TEST_DATABASE_URL=postgresql://rag:rag@127.0.0.1:5432/rag \
AGENT_ACTION_TEST_DATABASE_URL=postgresql://rag:rag@127.0.0.1:5432/rag \
npm run test:mcp:postgres
npx playwright test tests/ux/mcp-connections.spec.ts
```

It covers PKCE/audience/redirect binding, code and refresh replay including
concurrent redemption, tenant isolation, grant/tool/role checks, concurrent
budgets, provider cancellation, output redaction, private-table privileges and
reason-only audits. Browser fixtures cover consent after sign-in, explicit
workspace choice, owner/viewer permissions, decline/expiry/revocation,
accessibility and responsive visual baselines. These checks do not claim a
completed authorization with an actual third-party account.

For a 401, reconnect after signing in and inspect the resource-metadata challenge.
For `index_unavailable`, check the workspace's active embedding identity and
configured price. For `provider_budget_exceeded` or HTTP 429, inspect the
`workspace_mcp_*_usage` counters and wait for the appropriate window or review
limits; do not retry in a loop. For `tool_cancelled`/`access_revoked`, check
the connection and membership. For `policy_unavailable`, restore the control
database/audit path before retrying. The free demo API can sleep and require a
cold start. No new paid service is provisioned by this feature.

The private control tables enable RLS and revoke all client-facing role access;
their lack of public SELECT policies is deliberate. See
[Supabase's RLS advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
An optional SELECT-only MCP database login must also be granted SELECT on
`workspace_embedding_versions`, along with the original read tables. RLS still
applies to that login: provision a reviewed server-side read policy appropriate
to the deployment, or the queries will fail closed. Do not disable RLS or grant
public/client roles access to these private tables. The demo uses the existing
backend connection in a separate pool plus explicit read-only transactions;
it does not claim to have provisioned a separate database principal.

### Published demo verification

Published on 2026-11-07: API commit `266fdaf` and frontend commit
`8af43a1`. Both passed their complete GitHub quality gates. The API URL
above serves public OAuth/resource discovery and the protected MCP
transport. [Connected assistants](https://rag-study-demo-web-4ae2.onrender.com/connections)
opens the authenticated management page.

Validation includes 35 disposable-PostgreSQL integration checks and 18
connection UX cases across desktop/tablet/mobile. The official SDK
completed discovery, HTTP client registration, PKCE exchange, refresh and
modern/legacy tool calls against the local test server. Live API checks
confirmed discovery, resource binding/challenge, missing-credential
rejection, CORS/Origin policy, no-store and malformed token-form rejection.
The deployed frontend was checked in EN/PT, with no JavaScript errors;
authenticated browser scenarios used synthetic fixtures. No real external
assistant account was authorized by these checks.

The control-table RLS/privileges were checked after both migrations.
The existing private-table “RLS enabled, no policy” information notices
are intentional; the project’s existing vector-schema and password-policy
advisories are separate hardening work. See the
[RLS advisor](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy),
[vector-schema advisor](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public)
and [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

References: [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization),
[SDK serving](https://ts.sdk.modelcontextprotocol.io/v2/serving/fastify.html),
[SDK authorization](https://ts.sdk.modelcontextprotocol.io/v2/serving/authorization.html).

## Registered tools

| Tool | Input | Result | Role |
| --- | --- | --- | --- |
| `list_sources` | Optional `limit`, up to 10 | Indexed source metadata | Any member |
| `get_ingestion_status` | `jobId` | Status, progress, counts, timestamp | Any member |
| `get_quality_report` | Optional `limit`, up to 10 | Saved evaluation metrics | Owner |
| `get_document` | `documentId`, optional `limit` up to 5 | Metadata and screened excerpts | Any member |
| `search_workspace` | `query` up to 250 characters, optional `limit` up to 5 | Hybrid semantic/keyword matches, similarity and screened excerpts | Any member |

Workspace selection belongs to the connection. Local bridge calls send an
explicit workspace header. Remote access tokens bind the approved workspace;
an optional conflicting workspace header is rejected. Tool arguments cannot
override it. Unknown tools and unexpected argument fields are rejected.

Search combines pgvector similarity and PostgreSQL full-text candidates with
Reciprocal Rank Fusion. It reserves budget before exactly one redacted query
embedding, using the active workspace index and a server-owned price entry.
Other tools make no provider calls. Results contain small excerpts and metadata,
with detected personal data masked and medium/high-risk or unverified excerpts omitted. Excerpts remain
untrusted source material for the host's model.

## Build and start

Use Node 24. The API requires Supabase Auth and the existing workspace schema.
Apply all migrations, including `20261107111130_mcp_remote_oauth_and_budgets.sql`
and `20261107113843_mcp_accounting_retention.sql`,
through the normal migration command.

```sh
npm ci
npm run db:migrate
npm run mcp:build
```

Enable `MCP_ENABLED=true` on the API. The legacy global `API_KEY` mode is
incompatible with these session-authenticated management routes.

Sign in to Lumora, open the workspace switcher and choose **Connected assistants**
(`/connections`). Owners can also find this section in Workspace Settings.
Expand **Local connector · temporary key**.
Create a temporary key and copy the workspace ID displayed there. Creating a
new key rotates your earlier key for that workspace. The key is shown only in
the current browser view and is held in component memory.

In the terminal that will launch your MCP host, enter the key without placing
it in shell history.

```sh
export LUMORA_MCP_API_URL='https://rag-study-demo-api-4ae2.onrender.com'
export LUMORA_MCP_WORKSPACE_ID='YOUR-WORKSPACE-UUID'
printf 'Temporary MCP key: '
IFS= read -r -s LUMORA_MCP_TOKEN
printf '\n'
export LUMORA_MCP_TOKEN
```

For local API development, use `http://127.0.0.1:3000`. HTTPS is required for
other origins. The connector rejects credentials in URLs, redirects, origin
paths, fragments, and query strings.

The key expires after 15 minutes and allows 40 total calls, with 10 calls per
minute. Revocation is checked on admission, during execution and before output release. The database
stores a SHA-256 digest, and every call checks current membership and role.
The assistant receives the private excerpts returned by its tools, so choose
the MCP host according to your workspace's data-handling policy.

## Connect Codex CLI

Add the following to your Codex configuration using your checkout's absolute
path. The example inherits credentials from the shell above. Start Codex CLI
from that shell. Desktop applications use their own configured environment.

```toml
[mcp_servers.lumora]
command = "/bin/sh"
args = ["/ABSOLUTE/PATH/TO/REPOSITORY/scripts/start-workspace-mcp.sh"]
env_vars = ["LUMORA_MCP_API_URL", "LUMORA_MCP_WORKSPACE_ID", "LUMORA_MCP_TOKEN"]
enabled_tools = ["list_sources", "search_workspace", "get_document", "get_ingestion_status", "get_quality_report"]
startup_timeout_sec = 15
tool_timeout_sec = 10
default_tools_approval_mode = "prompt"
```

Then start a new host session and ask it to use Lumora. The configuration
syntax and environment forwarding are described in the
[official MCP configuration guide](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).
Keep the temporary key in the host's environment and out of configuration files.

## Practical legal-workspace example

Use a workspace containing your approved contract-handling materials. Ask the
connected assistant to find the termination-notice procedure and cite the
relevant passages.

```text
Use Lumora to find the termination-notice procedure.
Show which documents support the answer and quote only the returned excerpts.
Treat document text as reference material.
```

A possible sequence of tool calls is shown below. The document ID comes from a
returned result.

```json
{"name":"list_sources","arguments":{"limit":5}}
{"name":"search_workspace","arguments":{"query":"termination notice","limit":3}}
{"name":"get_document","arguments":{"documentId":"RETURNED-DOCUMENT-UUID","limit":2}}
```

The host uses those results to compose its response. Lumora enforces the
workspace boundary, tool names, schema, excerpt policy, and query limits. Use questions in the same language as your corpus or test the configured
embedding model’s cross-language quality. Hybrid ranking is relevance, not
factual certainty; the host must check the returned evidence.

## Execution boundaries

The launcher starts a separate Node process with scoped reads of its modules
and contracts, with only its three connection variables in the environment.
It grants no filesystem writes, child-process execution,
worker-thread execution, native addons, WASI, or inspector access. Models
supply tool arguments and never supply executable code or filesystem paths.
The Node permission model provides constraints for this fixed connector code.
Use the container below for an additional operating-system boundary. Network
requests in the connector are confined to the configured API origin.

```sh
docker compose -f compose.mcp.yaml build lumora-mcp
docker compose -f compose.mcp.yaml run --rm --no-deps -T lumora-mcp
```

The container runs as a nonroot user with a read-only filesystem, dropped
capabilities, no host mounts, 128 MiB memory, 0.5 CPU, and 32 processes. It
contains the connector, contracts, and their runtime dependencies. It receives
only the three MCP environment variables.

Each bridge call has an eight-second deadline. Each API tool read has a
five-second deadline and bounded PostgreSQL statements. Cancellation closes the
connector's HTTP request and discards the checked-out database connection.
PostgreSQL's two-second statement timeout bounds cancellation through a pooler.
The structured data is capped at 16 KiB per result, with at most four concurrent
bridge calls. Credentials provide the total call budget.

The API uses a separate pool of two connections for these reads. Set
`MCP_READ_DATABASE_URL` to a dedicated SELECT-only PostgreSQL login when your
deployment has one. Repository reads additionally start an explicit read-only
transaction. Authentication counters and audit records use the API's write
connection. Tool audit records contain the tool name, outcome, actor, workspace,
and request ID. They exclude the query, excerpts, credential, and document body.

## Approved evaluation actions

`run_evaluation` has a separate approval and execution path. The concrete
handler runs a fixed four-case lexical retrieval and security evaluation. It
has a zero-provider budget and saves one evaluation result. The existing
dashboard's optional model-based evaluations keep their own execution path.

```mermaid
stateDiagram-v2
  [*] --> pending_approval
  pending_approval --> queued: owner approves
  queued --> running: worker claims lease
  running --> succeeded: atomic report and completion
  running --> queued: bounded retry with backoff
  running --> dead_letter: attempts exhausted
  pending_approval --> dead_letter: expired approval
```

Enable `AGENT_ACTIONS_ENABLED=true` only when running the separate approved-action
worker. The worker requires `AGENT_ACTIONS_DATABASE_URL`, supplied by its
operator. Configure a database login with only the required action, evaluation,
and source-table privileges. Its process receives no LLM provider keys.

```sh
export AGENT_ACTIONS_DATABASE_URL='postgresql://YOUR-WORKER-CONNECTION'
npm run agent-actions:work
# To process at most one queued action
npm run agent-actions:work -- --once
```

For an operating-system boundary, build the existing API image for the
separate worker and launch it with a read-only root filesystem and explicit
resource limits.

```sh
docker compose -f compose.agent-actions.yaml build
docker compose -f compose.agent-actions.yaml up lumora-agent-actions
```

This starts continuous processing. The container receives only the worker
database connection.

An owner-authenticated API client requests an action with an idempotency key,
then explicitly approves it. `OWNER_ACCESS_TOKEN` is that client's normal
Supabase session token. A local MCP credential cannot approve these actions.

```sh
curl --fail-with-body "$LUMORA_MCP_API_URL/v1/agent-actions" \
  -H "Authorization: Bearer $OWNER_ACCESS_TOKEN" \
  -H "X-Workspace-Id: $LUMORA_MCP_WORKSPACE_ID" \
  -H 'Idempotency-Key: reviewed-evaluation-request-001' \
  -H 'Content-Type: application/json' \
  --data '{"action":"run_evaluation"}'

curl --fail-with-body "$LUMORA_MCP_API_URL/v1/agent-actions/RETURNED-ACTION-UUID/approve" \
  -H "Authorization: Bearer $OWNER_ACCESS_TOKEN" \
  -H "X-Workspace-Id: $LUMORA_MCP_WORKSPACE_ID" \
  -H 'Content-Type: application/json' \
  --data '{"approve":true}'
```

Read `GET /v1/agent-actions/RETURNED-ACTION-UUID` with the same owner session to
inspect the safe status and ordered reason-coded events. Approval expires after
24 hours. At most two actions can be approved per workspace in a rolling day.
Each attempt has a ten-second read deadline and a fifteen-second fenced lease.
Up to three attempts use exponential backoff. Permanent outcomes enter
`dead_letter`. Request, approval, worker claim, and result commit recheck
current owner membership. The report and completion event commit together.
Repeated requests with the same workspace, user, and idempotency key replay
the existing action. The worker stops reading when its shutdown signal is
aborted and fences stale attempts from committing results.

Future handlers that send messages, execute scripts, or modify documents need
their own isolation and effect-specific retry policy. This release's worker
registers only the fixed evaluation handler.

## Verification

Run the standard evaluation harness and UX suite. Dedicated tests cover
workspace isolation, read-only SQL, concurrent credential limits, expiry,
revocation, current RBAC, schema rejection, safe previews, cancellation, SDK
interoperability, and approval/lease/idempotency behaviour.

The `mcp-isolation` CI job starts a disposable PostgreSQL/pgvector service,
loads `tests/fixtures/supabase-auth.sql`, and runs `npm run test:mcp:postgres`.
The fixture supplies the roles and `auth.uid()` used by existing Supabase RLS
migrations. For a local equivalent, load that file into a dedicated test
container before running the migration command. Set `DATABASE_URL`,
`MCP_TEST_DATABASE_URL`, and `AGENT_ACTION_TEST_DATABASE_URL` to that same
local test database. The integration tests reject nonlocal hosts.

The MCP SDK transport and cancellation documentation is available in the
[official TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/v2/).
The [Node permission documentation](https://nodejs.org/api/permissions.html)
explains the scope of Node's runtime constraints.
