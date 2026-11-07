# Frontend architecture review

Audit date: 2026-11-07. Source baseline: `e25572d6118efbdb84190367a039526775fbd0b2`.

This review inspects the existing React, TypeScript, Tailwind CSS, TanStack Query and Feature-Sliced Design implementation. The consolidated [technical backlog](technical-backlog.md) tracks the proposed incremental changes. This audit performs no library migration, application rewrite or deployment. Findings describe the audited baseline; current implementation status is maintained in the technical backlog. Phase 1 implements FE-01/03 and the transport/error portion FE-02a. Estimates describe engineering effort, including focused verification, rather than delivery promises.

## Assessment

The current stack is suitable for the product. Keep React, TanStack Query, Zod, Tailwind and the existing Radix primitives. The main issues are the way session identity is represented in query keys, incomplete validation at API response boundaries, application orchestration inside a page slice, and missing automated architectural constraints. Another state library or UI framework would not address these issues.

The previous administrative monolith has already been split into section components, with lazy loading and section-specific queries. The remaining work is to make their boundaries, error isolation, query lifetime and contracts more consistent. No wholesale frontend rewrite is justified by this inspection.

### Evidence baseline

An inspection of `apps/web/src` found:

| Measure | Observed baseline | Interpretation |
| --- | --- | --- |
| TypeScript/TSX source files | 95 | A manageable codebase for incremental changes. |
| Physical TS/TSX lines | 8,305 | Size alone does not establish a maintainability problem. |
| Largest modules | `RagLabPage.tsx` 335; `rag-api.ts` 334; `WorkspaceUsage.tsx` 313; `GuideKnowledge.tsx` 312; `use-conversation.ts` 300 | Prioritize mixed responsibilities over an arbitrary line limit. |
| Static relative upward layer imports | 0 | Existing layer ordering is substantially respected. |
| Static same-layer imports between slices | 1 page-to-page import | Additional lazy page imports require the same correction. |
| Cross-slice imports into implementation files | 43 | Consumers depend on internal paths; explicit Public APIs are absent. |
| Slice `index.ts`/`index.tsx` files | 0 | Public API adoption needs a deliberate rollout. |
| Runtime/type cycles in inspected static relative-import graph | 0 / 0 | Do not claim existing circular-dependency defects. |
| Explicit TypeScript `any` keywords | 0 | Unsafe assumptions still exist at JSON decoding boundaries. |
| `useEffect` calls | 36 | Review lifecycle ownership; this count is not evidence of excessive effects. |
| `useMemo`/`useCallback` calls | 0 / 0 | Blanket memoization is not justified without profiling. |

The import graph measurement follows relative static imports and distinguishes type-only edges. It excludes dynamic imports, re-exports and non-relative package aliases. The page-to-page dynamic imports were reviewed separately. A future architecture gate must cover those cases rather than treating this one-off measurement as a complete guarantee.

Existing strengths to preserve:

- TypeScript `strict`, `isolatedModules`, bundler module resolution and `noEmit` are already enabled in `apps/web/tsconfig.json`.
- Shared Zod contracts already validate conversation, model-catalog, workflow, usage, MCP and streaming payloads in substantial parts of the client.
- TanStack Query already handles server state and request deduplication. Conversation creation has an in-flight deduplication reference and a stable draft identifier.
- Private conversations are backend records. `RagLabPage.tsx:274` persists the legacy question history only for the public/demo area. `use-live-answer.ts:33-43` stores a run identifier for reconnection rather than the prompt itself.
- `LabExperience` is keyed by user and workspace (`RagLabPage.tsx:226-228`), which remounts its local state on scope changes. This is relevant protection; the query-cache finding below is not a demonstrated cross-user UI disclosure.
- Radix Select and DropdownMenu are established. `SelectField.tsx:33-34,47-48` deliberately places popovers inside a native dialog when needed and enables collision handling.
- The shared native-dialog `Overlay` restores focus, supports dismissal policies and exposes accessible title/description relationships (`Overlay.tsx:16-40`).
- Source excerpts are rendered as React text. No `dangerouslySetInnerHTML`, `innerHTML` or `eval` use was found in frontend source. Original-file preview checks MIME type; object URLs and pending requests are cleaned up.
- Responsive Playwright suites, screenshot baselines, axe checks and keyboard/focus tests already exist in `tests/ux`. This is not a project with no UI testing.

## Responsibility and state ownership

Preserve a small number of clear responsibilities:

| Concern | Preferred owner using the current stack | Current adjustment needed |
| --- | --- | --- |
| Session lifecycle, route composition and active workspace | `app` composition and narrowly scoped providers/hooks | Move orchestration out of `pages/rag-lab`. |
| Page content | `pages` composing widgets/features | A page must not route to or import another page's implementation. |
| Domain server records | TanStack Query options under the owning entity/feature API/model | Stable identity keys, consistent cancellation and response validation. |
| Navigable section, conversation and shareable filters | URL state through the existing route adapter | Consolidate subscriptions and define filter serialization before adding another router. |
| Draft forms and transient presentation | Local component state/native forms | Extract focused hooks only when a component mixes substantial async/domain logic. |
| Cross-page client state | Minimal session/workspace context where genuinely shared | Do not introduce a global store for fetched server records. |
| Durable conversations, feedback, memberships and onboarding progress | Authorized backend product records | Browser storage remains a preference/recovery aid, not the source of truth. |
| Generic buttons, dialogs, select primitives and tokens | `shared/ui` and shared styles | Separate generic primitives from source/evidence-specific presentation. |
| Source/evidence semantics | A knowledge/source entity or the feature that owns the interaction | Currently some domain UI and DTOs live in generic `shared` modules. |

## Prioritized technical backlog

Priority meanings: **P1** protects private data boundaries or a concrete behavior contract; **P2** improves maintainability, reliability or measurable operating cost; **P3** follows after those foundations. Effort bands are **S** (roughly 0.5–1.5 engineering days), **M** (2–3) and **L** (4–6). Large tasks should be delivered in separate reviewable changes.

### FE-01 — Remove credentials from cache identity and unify session cleanup

**Priority:** P1. **Effort:** M. **Dependencies:** none; coordinate identity conventions with the backend audit.

**Problem and location.** Bearer tokens are included in query keys in `pages/rag-lab/ui/RagLabPage.tsx:90`, `entities/workspace/model/knowledge.ts:5`, `members.ts:6`, `usage.ts:6`, `widgets/workspace-control-center/model/queries.ts:6,12,20`, and `features/question-answering/model/use-saved-conversations.ts:44-50`. Query keys are in-memory cache metadata, not a credential store. Token refresh also creates a new cache identity for otherwise unchanged data. The client is module-global (`app/providers/QueryProvider.tsx:4`). Manual sign-out clears it (`RagLabPage.tsx:170-182`), but the Supabase auth-event callback only updates session state (`116-122`). Other auth transitions do not use the same explicit cleanup path.

**Proposed change.** Use domain-specific query-key factories keyed by opaque user/session identity, explicit workspace and request parameters. Keep the access token inside the request closure. Define one auth-transition handler that cancels affected private queries and client stream work, removes data belonging to the previous identity, and resets selected private state. Refreshing a token for the same identity should not create a new data namespace. Treat membership loss and workspace switching explicitly; decide how long inactive workspace data may remain cached rather than clearing every domain on every navigation.

**Why this approach.** It uses TanStack Query and the current auth subscription. It reduces credential retention and needless refetches without adding Zustand or changing authentication transport. The keyed `LabExperience` remount already protects local rendered state and must be retained or replaced with equivalent guarantees.

**Trade-offs and risks.** Removing the token without replacing its implicit identity isolation would be unsafe. Key changes must update invalidations, optimistic writes and scoped infinite-query prefixes together. Cancellation must distinguish detaching a client stream from cancelling a durable server execution; do not silently terminate durable work merely because a user changes sections.

**Acceptance and verification.**

- No query key contains a sentinel bearer token in a cache inspection test.
- Token refresh for the same user/workspace reuses the correct cache; switching users does not reuse that cache.
- Manual logout, external/cross-tab logout and signing into another account run the same cleanup contract.
- Delayed old-user/old-workspace responses cannot repaint the new scope. Tests cover switching while documents and conversation messages are loading.
- No raw prompt/source content or bearer token is placed in a diagnostic event while testing these transitions.

### FE-02 — Validate API responses and consolidate transport behavior

**Priority:** P1. **Effort:** L in domain-sized changes. **Dependencies:** agree shared-contract ownership with the backend audit.

**Problem and location.** `shared/api/rag-api.ts:108-120` returns `response.json() as Promise<T>`, so many response shapes are trusted without runtime verification. Locally declared search, document, ingestion, workspace, member and evaluation DTOs (`9-83`) duplicate server assumptions even though `@rag-study/contracts` already exists. JSON, void and streaming paths decode errors differently: `request` retains `body.code`, while `requestVoid` (`123-127`) and `answer-stream.ts:19-22` drop it. The void transport also omits the JSON content-type applied by `request`: `changeWorkspaceMemberRole` (`rag-api.ts:239`) sends a stringified PATCH body through `requestVoid` with only authorization/workspace headers. In a browser this can be delivered as `text/plain`, making member-role updates dependent on server parser behavior.

**Proposed change.** Keep a small shared fetch transport responsible for API base URL, header construction, abort/deadline composition and one safe error envelope. Domain-owned API modules should provide a Zod decoder per successful JSON response. Move remaining wire DTOs into the existing shared-contract package where the backend can use them too; infer TypeScript types from those schemas. Preserve dedicated bounded SSE parsing and original-file blob handling rather than pretending every endpoint returns JSON. Ensure JSON-bodied void requests declare JSON content type and preserve reason codes.

**Why this approach.** It extends a pattern the project already uses instead of introducing an HTTP client library or generated SDK. It prevents malformed or version-skewed data from failing later inside unrelated rendering code.

**Trade-offs and risks.** Runtime validation has a small cost and overly strict schemas can reject intentionally optional rollout fields. Define compatibility at the API boundary, test it, and do not silently coerce unknown roles, unsafe URLs or unsupported execution states. Splitting the API module must not change headers, routes, response shapes or provider invocation counts.

**Acceptance and verification.**

- Each private JSON resource family has one shared schema, and invalid success payloads produce a controlled contract error before entering query state.
- Member role PATCH requests have JSON headers and the expected payload; an integration test exercises an owner changing a member role.
- JSON, void, upload and SSE errors retain the same safe `status`/`code` contract for quota, forbidden, expired-session and validation failures.
- No bearer token, raw server body, question or source excerpt is included in client diagnostics.
- Existing API and UX suites pass without changing public endpoints or happy-path behavior.

### FE-03 — Isolate section failures and make client diagnostics safe

**Priority:** P1. **Effort:** S–M. **Dependencies:** FE-02 for consistent transport reason codes; a first boundary change can be independent.

**Problem and location.** The single root boundary in `main.tsx:9-14` renders a full-page reload screen. `WorkspaceControlCenter.tsx:29-30` has section-level Suspense but no section-level error boundary. A rejected lazy import or rendering exception in a section can therefore replace the entire application. `app/ErrorBoundary.tsx:14-15` logs the full error object and component stack. This is currently browser-console output, not proof of remote data exfiltration, but later console-capturing monitoring could retain sensitive error messages.

**Proposed change.** Add recoverable route/section boundaries around independently loaded workspace, chat and onboarding surfaces. Preserve the navigation shell and expose a retry/reopen action. Introduce a tiny diagnostic adapter with fixed event/reason codes, release identifier and an optional safe request correlation identifier. Keep errors' raw server bodies, user text and document content out of this adapter. A remote monitoring provider can later implement the adapter if selected; do not install one simply to wrap `console.error`.

**Trade-offs and risks.** A boundary cannot repair a genuinely invalid application-wide session. Recover only the failed scope, prevent automatic retry loops, and retain a root fallback for unrecoverable failures. Do not conceal contract failures behind an empty success state.

**Acceptance and verification.** A controlled lazy-load rejection and rendering exception display a localized accessible error; another section remains usable; retry can recover; focus reaches the recovery action. Captured diagnostics contain fixed codes and no sentinel prompt, excerpt or access token.

### FE-04 — Move application orchestration out of the RAG page

**Priority:** P2. **Effort:** L, split by responsibility. **Dependencies:** FE-01 key/session policy; preserve FE-03 isolation.

**Problem and location.** `app/App.tsx:1-4` delegates the application to `RagLabPage`. That page owns auth state, route observation/guards, workspace selection, onboarding gating, redirects, local preference storage, page composition and the private/demo shell (`RagLabPage.tsx:75-231`). It statically imports `SignInPage` at line 13 and lazily imports the onboarding and MCP-consent pages at lines 26 and 30. `LabExperience` in the same file also composes the chat, history, search, overlays and control center (`243-334`). These are application responsibilities rather than a single page's domain.

**Proposed change.** First extract typed application session/workspace orchestration and route composition into `app`. Then let independent pages render content through a reusable shell widget. Keep `shared/lib/app-route.ts` as the native routing adapter initially. Expose small focused hooks for session/workspace orchestration where this removes mixed async responsibilities; do not create a generic service/controller hierarchy for React. Preserve current role guards as UX affordances while the server remains authoritative.

**Trade-offs and risks.** Auth/onboarding redirect order is subtle, particularly deep links, invitations, multiple workspaces and MCP OAuth consent. Move one responsibility per change, backed by the current behavior tests. A router migration is a separate decision only if the existing adapter cannot meet concrete route requirements.

**Acceptance and verification.** No page imports another page's implementation. `app` owns route and session composition. Tests cover deep links before/after sign-in, incomplete onboarding, MCP consent, two workspaces with different roles, browser back/forward and failed sign-out. Successful actions keep the same URLs and backend contracts. No additional global store or duplicate auth subscription is introduced.

### FE-05 — Add Public APIs and an architecture gate that prevents new violations

**Priority:** P2. **Effort:** M–L. **Dependencies:** FE-04 removes page-to-page composition first; a read-only tool pilot can run earlier.

**Problem and location.** The repository has recognizable FSD layers but no slice Public APIs. The static audit counted 43 imports into another slice's implementation path, including imports of feature UI/model internals and workspace query helpers. No automated FSD, import-boundary or circular-dependency check is configured in the root/web scripts or CI. The current lack of cycles is an observed snapshot, not a maintained guarantee.

**Proposed change.** Add explicit named exports at each consumed slice boundary and update its external consumers incrementally. Internal imports inside the same slice stay relative. Keep generic shared modules narrow; do not create one root `shared/index.ts` or export every implementation. Evaluate a single development-only structural/import gate against the real codebase, with explicit test fixtures for bad edges and type-only edges. The accompanying tooling review compares Steiger, scoped FSD lint alternatives and dependency graph tooling; choose the smallest justified combination rather than installing all of them. A baseline ratchet, if needed, must be explicitly implemented or supported by the chosen tool, not assumed to exist.

**Trade-offs and risks.** Barrels can accidentally create cycles or merge lazy chunks if exports eagerly pull unrelated modules. Preserve lazy import boundaries and verify the bundle. Not every slice needs every `ui/model/api/lib/config` directory; only add segments that hold a real responsibility. Document narrow exceptions with rationale and an owner instead of ignoring a whole layer.

**Acceptance and verification.** External imports use slice Public APIs. CI rejects newly introduced upward imports, cross-slice private imports and runtime cycles; it reports type-only dependencies distinctly. Fixtures prove a prohibited dynamic page import is detected. Existing exceptions are named and cannot silently grow. The check runs locally and in CI; no large entry-bundle increase is accepted as a side effect of re-exports.

### FE-06 — Standardize query cancellation, deadlines and polling ownership

**Priority:** P2. **Effort:** M. **Dependencies:** FE-01 and FE-02.

**Problem and location.** Cancellation is uneven. Document/member/knowledge queries consume TanStack's signal, but ingestion jobs (`widgets/workspace-control-center/model/queries.ts:11-14`), evaluation runs (`19-22`) and usage (`entities/workspace/model/usage.ts:7`) ignore it. Documents/jobs poll every 5/3 seconds respectively; usage polls every 30 seconds. Conversation messages poll every 2 seconds while active and every 15 seconds when settled (`use-saved-conversations.ts:61-83`). `LabExperience` initializes the conversation hook for every tab (`RagLabPage.tsx:264`), so mounted background work deserves a request-count check. The knowledge query already stops on errors, and evaluation polling already stops when there is no active workflow; preserve these existing behaviors.

**Proposed change.** Pass each query's AbortSignal through the domain API to fetch, compose a documented deadline, and centralize retry classification for read-only failures. Scope polling to records that can still change and to the appropriate active/visible surface, with safe background reconciliation for durable runs. Invalidate after successful mutations rather than continuously refreshing settled lists. Do not add automatic retries to paid/provider actions or non-idempotent submissions.

**Trade-offs and risks.** Disabling all background reconciliation can hide completion of a long-running job. Cancelling a browser fetch is different from cancelling the server workflow. Define both behaviors explicitly and preserve resumable execution identifiers.

**Acceptance and verification.** A delayed old-scope request receives abort on identity/scope disposal. Idle completed sections do not poll every three seconds; active jobs still update within the documented interval. A controlled multi-tab/navigation test records requests before/after and demonstrates fewer idle requests with no duplicate mutation/provider calls. Offline, 401, 403, 429 and server errors follow bounded, differentiated retry behavior.

### FE-07 — Make chat lifecycle states explicit and test asynchronous transitions

**Priority:** P2. **Effort:** M–L. **Dependencies:** FE-01/02; coordinate with durable-run backend contracts.

**Problem and location.** `use-conversation.ts:17-28` represents turns with status/mode plus several optional answer/comparison/error fields, allowing invalid combinations. Mode-specific casts appear later in the module. The same feature coordinates server conversations (`use-saved-conversations.ts`, 210 lines), live streaming (`use-live-answer.ts`, 263) and turn reconciliation (`use-conversation.ts`, 300). Responsibilities are already partly separated, but their transition contract is implicit. The stream hook uses latest-value refs and abort cleanup deliberately; those should not be removed as cosmetic changes. The conversation-library button is disabled while submitting (`QuestionAnswerForm.tsx:73,140`), so a hypothetical create/open race is not a confirmed UI defect from static inspection.

**Proposed change.** Introduce local discriminated unions for answer/comparison turns and pending/settled/failed/cancelled states, aligned with existing Zod wire contracts. Extract deterministic reconciliation/transition helpers only where that makes async ownership testable. Preserve stable submission/run IDs, in-flight conversation creation deduplication and stream resume cursors. Define the distinction between section navigation, opening a different conversation, browser reconnection and explicit cancellation.

**Trade-offs and risks.** A generic state-machine dependency is unnecessary unless the explicit union/reducer approach proves insufficient. Avoid moving every effect into another hook without reducing responsibility. Validate behavior before changing the dependency-list strategy around pending-turn reconciliation.

**Acceptance and verification.** Type checking rejects impossible answer/comparison states. Focused tests cover duplicate submission retries, create pending during navigation, late completions after a scope change, reconnect with repeated event IDs, cancel-before-admission and reconnect after a terminal event. Existing durable-conversation E2E tests still show one ordered conversation and one backend run per idempotent submission.

### FE-08 — Extend the existing quality gates with focused frontend checks

**Priority:** P2. **Effort:** M. **Dependencies:** focused tests can accompany FE-01/02/07; architecture tool choice follows the tooling review.

**Problem and location.** The web package exposes build/typecheck/dev/preview scripts but no lint, formatting or unit/component-test command. There are no frontend source test files. Root `npm test` targets the API tests. This is offset by substantial Playwright coverage and CI execution (`.github/workflows/quality-gates.yml:79`), not a reason to replace it.

**Proposed change.** Keep the current responsive, visual, accessibility and integration suites. Add targeted tests for contract decoding, query-key/session cleanup, chat reconciliation and form/network failure behavior where E2E would be slower or less diagnostic. Select development-only lint/hook/FSD and test tools after the compatibility review and a small pilot; do not add Vitest, RTL, MSW, ESLint and several architecture plugins as a bundle. Start with rules that catch concrete defects; record existing warnings and prevent regressions. Establish one formatting convention without mass-formatting unrelated modules in a behavior change.

**Trade-offs and risks.** Test dependencies and rule versions must match the installed Vite, Node, TypeScript and React versions, including CI. A broad formatting change obscures review and creates avoidable merge conflicts. Test observable contracts rather than implementation details or every trivial primitive.

**Acceptance and verification.** Document reproducible local commands and run the same selected checks in CI. A deliberately invalid effect dependency, import-boundary fixture and malformed API payload are caught by the appropriate check. Critical component tests verify behavior and accessible roles, while existing screenshot baselines change only after an intentional reviewed visual change. The initial test set targets the listed risks rather than an arbitrary coverage percentage.

### FE-09 — Consolidate existing primitives and semantic design tokens

**Priority:** P2 after reliability work. **Effort:** M. **Dependencies:** FE-05 determines Public APIs; no new component framework is required.

**Problem and location.** Shared button classes and focus/disabled/reduced-motion styles already exist (`styles.css:10-13,69-87,96-106`). The app has an established dark palette (`styles.css:7-8`), and document date fields explicitly declare a dark native color scheme. Most other component colors and repeated surfaces remain inline Tailwind classes, while only a small number of theme variables are centralized (`styles.css:3,7`). `OriginalDocumentAction.tsx:29-32,87` implements its own native-dialog surface alongside `shared/ui/Overlay.tsx`, increasing the number of dismissal/focus implementations. Generic `shared/ui` also holds domain-specific source/evidence presentation (`RagEvidencePanel`, `SearchResultCard`, `SourcePreview`).

**Proposed change.** Add only the semantic tokens and small typed primitives needed by observed repetition: primary/secondary/destructive action, surface, text, border, focus, disabled and status roles. Preserve native props and accessible names. Reuse the existing Overlay for compatible dialogs, retaining original-file MIME safeguards, request cancellation and object-URL disposal. Move source/evidence semantics into their domain boundary when Public APIs are established; keep Overlay, Select and ActionMenu generic. Continue using the present Radix Select/Dropdown primitives and their dialog-aware portals.

**Trade-offs and risks.** A universal Button with dozens of props or a broad shadcn/Base UI migration would add scope without solving a demonstrated limitation. Class-composition packages are optional if conflicting variants become a real issue; simple typed maps/native templates are enough initially. Do not add a new theme or redesign all screens as part of architecture cleanup.

**Acceptance and verification.** The migrated actions expose consistent hover, focus, disabled and pending states. Dialog close/cancel rules, focus restoration, select behavior inside dialogs and reduced-motion behavior retain their existing tests. Axe contrast and keyboard checks run at mobile/tablet/desktop sizes, including the established dark palette and native date/control surfaces. No new UI framework is introduced and no source content is rendered as untrusted HTML. A new light theme or automatic theme switching is a separate product decision rather than an assumed architecture requirement.

**Implementation follow-up:** FE-09 now consolidates the compatible dialogs and
semantic action states; source/evidence UI moved to `entities/source`. See the
[primitive guide](frontend-primitives.md) and the [dated release record](operations/release-2026-11-07-ui-primitives.md)
for validation/publication status. The audit locations above describe the reviewed
baseline and are retained as historical evidence.

### FE-10 — Measure frontend performance before adding optimization libraries

**Priority:** P2 for measurement; optimizations follow demonstrated bottlenecks. **Effort:** S for baseline, then bounded tasks from evidence.

**Problem and location.** The application already lazy-loads workspace sections, but the sign-in/demo entry imports chat, search, history and other feature modules through `RagLabPage.tsx:5-24`. The inspected local build had 18 JavaScript chunks, approximately 252,262 gzip bytes in total; the main entry alone was 620,373 raw / 191,142 gzip bytes. These are local artifact measurements at the audited source baseline, not a production network/Lighthouse result. Conversation rendering flattens all loaded message pages (`use-saved-conversations.ts:85-90`) and the transcript maps all turns (`ConversationThread.tsx:130`); token updates also drive scroll measurement (`84-95`). Pagination and pinned-scroll handling already exist. No React Profiler, Lighthouse or field measurements were collected in this audit.

**Proposed change.** Capture repeatable build-size, route-load, request-count and long-chat interaction baselines. After FE-04, isolate private route code from sign-in if bundle analysis shows an actual entry reduction. Profile streaming and long histories before adding memoization or virtualization. If needed, batch token presentation and memoize expensive stable turn subtrees while preserving accessible live announcements. Introduce list virtualization only after a representative corpus/history demonstrates a bottleneck and backscroll/focus restoration are specified.

**Trade-offs and risks.** Excessive splitting adds waterfalls; broad barrels can undo splitting; virtualization can harm screen readers and historical scroll restoration. Zustand, TanStack Table and TanStack Virtual are not justified merely because the project may grow. A second table/state layer is not a prerequisite for performance.

**Acceptance and verification.** Store the measurement environment and baseline artifact. The initial load and long-chat tests can be rerun locally/CI. A budget flags unexplained entry-size growth relative to that baseline, with a reviewed exception mechanism. Any optimization reports its actual before/after size or render/request measurements and retains streaming cancellation, keyboard access and pinned-scroll behavior. Do not claim improved LCP or responsiveness without measuring it.

### FE-11 — Normalize form and URL state only where it improves real flows

**Priority:** P3. **Effort:** M across small changes. **Dependencies:** FE-02/04/07.

**Problem and location.** Native routing and local form state coexist appropriately, but route observation is spread between `RagLabPage.tsx:107-114` and `use-saved-conversations.ts:91-98`. Domain features manage local draft/submitting/error state in different styles. Existing Zod input schemas cover question/comparison inputs, but not every form shares the same safe error/pending conventions. Documents already support backend filters; deciding whether those filters are navigable state belongs to the routing design, not a separate global store.

**Proposed change.** Consolidate location observation behind one native route adapter, then expose typed page-specific parsing/serialization for sections, conversation selection and useful shareable filters. Keep transient form drafts local. Reuse a small set of input validation and pending/error presentation conventions. Evaluate React Hook Form only for a form with demonstrated repeated validation/touched/field-array complexity; do not migrate simple upload/search/invite forms automatically. Keep locale detection automatic and preserve existing English/Portuguese behavior.

**Trade-offs and risks.** Putting every draft into the URL can leak user text into browser/server history; never encode question text, document contents, tokens or sensitive invitation material. A form framework adds indirection and migration cost for simple inputs. Avoid a router/state/form dependency trio unless each solves a separate measured problem.

**Acceptance and verification.** Back/forward restores the correct safe section/conversation/filter state without duplicate subscriptions. Sensitive drafts do not enter URLs or browser diagnostics. Invalid form inputs show accessible field-level errors and preserve drafts after a recoverable request failure. English/Portuguese, owner/editor/viewer permissions, keyboard submission and loading/disabled states retain behavior tests.

## Tooling compatibility and adoption decisions

This is a metadata/documentation review on 2026-11-07, not a successful installation or runtime compatibility test. No package was added. A candidate must pass a small real-repository pilot before becoming a required development/CI tool. Compare dependency changes, transitive audit results, execution time, entry-bundle impact and the migration diff; use development-only dependencies for checks.

### Installed baseline

The lockfile resolves React/React DOM **19.3.1**, TypeScript **5.9.3**, Vite **6.4.5**, the React Vite plugin **4.7.0**, Tailwind and its Vite plugin **4.3.4**, TanStack Query **5.106.1**, Zod **4.6.7**, Radix Select **2.4.1**, DropdownMenu **2.2.1**, Playwright **1.64.1** and axe/Playwright **4.14.0**. Supabase JS is **2.49.8**, with Auth JS **2.69.1**. Lockfile versions differ from broad manifest ranges and should be used for compatibility checks.

CI and the API image use Node 24, while the root manifest still permits Node `>=20`. New tooling that requires a newer minimum must not be silently introduced under that declaration. Resolve the supported development baseline in BE-14/FE-08 first. There is no configured ESLint, Prettier, Steiger, Vitest, RTL or MSW dependency today; an earlier one-off formatter invocation is not a maintained formatting setup.

### FSD and dependency checks

| Candidate | Verified metadata and coverage | Fit, limitations and decision |
| --- | --- | --- |
| [Steiger](https://github.com/feature-sliced/steiger) **0.9.0**, official FSD plugin **0.8.2** | Published November 1; Node `>=22.18`; project explicitly labels the tool beta. Relevant rules include `fsd/forbidden-imports`, `fsd/public-api` and `fsd/no-public-api-sidestep`. | Preferred first **read-only pilot** for FSD-specific diagnostics. Pin versions and test rules against actual relative imports, dynamic imports and exceptions. Beta configuration churn is a maintenance cost. A native baseline/ratchet facility was **not verified**; use narrow activation or explicitly reviewed exceptions rather than promising one. |
| [@conarti/eslint-plugin-feature-sliced](https://github.com/conarti/eslint-plugin-feature-sliced) **2.0.1** | September 18 release; ESLint `>=9`, flat config; independent community plugin. | Alternative if one ESLint pipeline gives sufficient coverage. Type-only edges are excluded by default and filesystem path rules are not a complete runtime graph. Disable import-style preferences that conflict with current relative imports. Do not adopt alongside Steiger by default. |
| [eslint-plugin-feature-sliced](https://registry.npmjs.org/eslint-plugin-feature-sliced) **0.0.2** | Exact **unscoped** package last published December 25, 2023; registry metadata lacks a repository link. | Distinct from the scoped plugin above. Current maintenance/flat-config compatibility evidence is insufficient for the proposed gate. Do not install it based on the similar name. |
| [@feature-sliced/eslint-config](https://github.com/feature-sliced/eslint-config) **0.1.1** | April 30, 2024 release; documented configuration uses legacy `.eslintrc` and import/boundary plugins. | Not a drop-in flat-config adoption. Evaluate migration/coverage if chosen; age alone does not establish that the package is unsupported. |
| [eslint-plugin-feature-sliced-design](https://registry.npmjs.org/eslint-plugin-feature-sliced-design) **1.11.2** | February 4, 2025 release; ESLint peer `^7`. | Poor fit for a new modern lint baseline without a demonstrated compatibility path. |
| [dependency-cruiser](https://github.com/sverweij/dependency-cruiser/blob/main/doc/options-reference.md) **18.7.2** | November 2 release; supports the current Node 24 build environment; documents TypeScript pre-compilation edges and a baseline option. | Consider one shared frontend/backend graph gate if it adds cycle/dynamic/import coverage absent from the selected FSD checker. It is another tool to maintain. Type-only edges and excluded files must be deliberate. A documented dependency-cruiser baseline does not imply Steiger has one. |

FE-05's pilot must include prohibited upward imports, cross-slice private imports, page-to-page static/dynamic imports, an introduced runtime cycle, a legal internal relative import, a legal shared segment and a type-only edge. Record any uncovered case and its separate check. Public APIs follow the [FSD guidance](https://fsd.how/docs/reference/public-api/); avoid a global barrel or directories with no responsibility. Enforce proven rules first and reject growth of reviewed exceptions in CI.

### Quality and product libraries

| Responsibility | Existing approach and evaluated option | Decision and measurable adoption condition |
| --- | --- | --- |
| Server state | TanStack Query already handles caches, infinite queries and mutations. Its [query-key guidance](https://tanstack.com/query/latest/docs/framework/react/guides/query-keys) and [cancellation mechanism](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation) cover FE-01/06. | Keep it. Do not duplicate fetched records into Zustand. A new store needs a demonstrated cross-page **client** state problem that composition/context cannot keep small. |
| Forms and validation | Native React forms/local state and existing Zod contracts. React Hook Form is an option for repeated touched/field-array/conditional validation work. | Keep simple forms; adopt only for an identified complex form with fewer repeated state transitions and unchanged accessible behavior. No blanket migration. |
| Accessible components | Existing Radix Select/DropdownMenu and native-dialog Overlay have portal, focus and keyboard coverage. Base UI/shadcn patterns are alternatives, not missing prerequisites. | Consolidate existing primitives and dark-palette tokens with measured contrast. A toolkit migration requires a concrete missing capability, migration/a11y tests and bundle evidence; installing one does not establish theme accessibility. |
| Class variants | Tailwind classes plus small typed maps/native string composition. CVA, clsx and tailwind-merge can handle substantial variants/conflicts. | No dependency for trivial concatenation. Consider only after documenting repeated contradictory variants and verifying Tailwind 4 merging behavior. |
| Tables/long lists | Existing lists and paginated conversations. TanStack Table/Virtual are evaluated only for measured interaction/volume limits. | Measure with representative histories and the [React Profiler](https://react.dev/reference/react/Profiler). Virtualization needs keyboard, screen-reader, backscroll and focus acceptance before adoption. |
| Lint and hooks | Candidate [ESLint](https://registry.npmjs.org/eslint) **10.14.0**, [typescript-eslint](https://registry.npmjs.org/typescript-eslint) **8.72.1**, [react-hooks plugin](https://registry.npmjs.org/eslint-plugin-react-hooks) **7.1.1** have compatible metadata for the inspected TS/CI baseline. | Run a pinned dev-only pilot; peer metadata is not runtime verification. Start with correctness/promise/Hook rules and explicit exceptions; no mass formatting or blanket memoization. Prettier is optional once a convention is agreed. |
| Unit/component tests | [Vitest](https://vitest.dev/guide/) **5.1.0** requires Node 22.12+ and Vite 6.4+; installed Vite fits, the manifest's Node 20 range does not. [RTL](https://registry.npmjs.org/%40testing-library%2Freact) **16.3.3** supports React 19. | Use native tests for pure helpers when sufficient; pilot Vitest/RTL for behavior that benefits from a DOM tier. Retain Playwright, screenshots and axe; measure improved failure diagnosis/runtime for FE-01/02/07 rather than adding a test runner for every component. |
| Network mocks | Existing Playwright route fixtures. [MSW](https://registry.npmjs.org/msw) **3.0.4** was published November 6; requires Node 22.12+ and TS 5.9+. | Do not install a one-day-old major automatically. A shared browser/component mock need, release review and a safe Fetch compatibility pilot must justify it. Real-parser integration tests still cover the member-role PATCH defect. |
| Monitoring | Root boundary and browser console; backend already has safe reason codes/correlation. Sentry/RUM is optional. | Add a privacy-preserving diagnostic port first. Review session replay, URLs, breadcrumbs, consent, redaction, retention, bundle and service cost before enabling collection. Do not capture bearer tokens, questions or passages. |
| API type generation | Existing shared Zod contract package, partly adopted. OpenAPI generation is a future integration option. | Finish a single wire-contract source first. A separately handwritten OpenAPI schema/generated client would duplicate the current problem. Preserve dedicated SSE/blob paths. |

### Security review boundaries

No unsafe HTML execution path was found in the inspected frontend. This does not prove that XSS, CSRF or session failures are impossible. Keep React text escaping and controlled original-file MIME handling, test malicious titles/excerpts/URLs, and preserve the backend's tenant and role checks. Bearer headers are explicit credentials rather than ambient application session cookies; review CORS/origin, OAuth redirect/PKCE and any future cookie transport separately before making CSRF claims. Cache cleanup, safe errors and no sensitive URL state are concrete work in FE-01/02/03/11. Dependency advisories are tracked jointly in BE-14; do not duplicate upgrades across workspace manifests.

## Delivery sequence

1. **Boundary protection:** FE-01, the JSON/header/error portion of FE-02, and FE-03. Add focused transition and transport tests as part of these changes.
2. **Maintainable module boundaries:** FE-04, then FE-05; finish FE-02 domain-by-domain. Run the FSD tooling pilot before enforcing it and protect lazy chunks from barrel regressions.
3. **Async reliability and request cost:** FE-06 and FE-07, with FE-08 checks that cover their meaningful failure cases.
4. **Consistency and measured improvements:** FE-09 and FE-10, followed by FE-11 only where a flow benefits.

Avoid combining session behavior changes, wholesale file moves, formatting and new lint enforcement in one pull request. Each step should preserve existing endpoint contracts and product behavior, state its affected scope, and cite the specific verification it ran.

## Decisions deliberately deferred

- No automatic migration to another router, UI toolkit, auth transport, global state manager or HTTP library.
- No mandatory Zustand, React Hook Form, table, virtualization, Sentry or RUM dependency without a concrete adoption task and measured benefit.
- No claim of a proven cross-user disclosure, XSS/CSRF exploit, measured slow rendering or existing dependency cycle based only on the static findings above.
- No invented requirement to create every possible FSD segment, use every design pattern, memoize every callback or achieve an arbitrary test coverage percentage.
- No change to backend authorization: client role checks continue to guide the UI; tenant scope, membership and access decisions remain enforced by the server.

The completed deliverable for this audit is the evidence-backed plan. Application changes, dependency adoption and releases have their own incremental implementation and validation records in the technical backlog. Keep the dated baseline evidence above rather than interpreting each finding as an unresolved current defect.
