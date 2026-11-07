# Native navigation, safe URL state and recoverable drafts

FE-11 keeps the existing native router, React, Query, Zod and accessible controls.
No router, form library or global state manager is added.

## State ownership

| State | Owner and lifetime |
| --- | --- |
| Section and selected saved conversation | Native browser history, read through one external-store subscription |
| Knowledge document/language/type/calendar filters | Validated metadata in the page URL, then workspace-scoped Query keys |
| Question, source-search text, import URL/title and form errors | Mounted local form; never serialized into the page URL |
| Conversation contents and execution | Authorized backend records and existing incremental Query/stream readers |
| Workspace, membership and permissions | Signed-in workspace selection and server authorization; never accepted from filter parameters |

`shared/lib/browser-location.ts` exposes a primitive snapshot and uses React's
`useSyncExternalStore`. The first subscriber attaches one native `popstate`
listener and the last removes it. No-op notifications do not increment its
navigation revision. Application scrolling reacts to pathname changes, so a
filter or conversation query change does not reset the whole page scroll.

## URL policy

`app-route.ts` accepts exactly one RFC UUID conversation parameter on `/ask`.
Knowledge accepts only `documentId`, `language`, `format`, `from` and `to`, in a
stable order. Ambiguous keys are discarded; invalid metadata combinations fail
closed. Dates are real UTC calendar days and the start cannot follow the end.
Unknown/private query parameters are removed when resolving an authorized private
route. Role-based section resolution remains an application concern.

Bootstrap parsing uses native `URLSearchParams`, a bounded UUID grammar and
small metadata checks. Boundary-value tests compare this metadata subset with
the shared Zod request schemas. Full form/API decoding still uses those schemas;
the URL parser is neither a second HTTP contract nor an authorization mechanism.
This avoids initializing the full runtime contract barrel on the entry path.

Switching workspaces removes a selected conversation or document-specific filter
before the new scope renders. Generic language/type/date filters remain useful
across libraries. User/workspace Query keys, component scope resets and server
membership checks retain isolation. Back/Forward may reuse a fresh cached query;
restoring the page does not require another provider call or duplicate submission.

## Recoverable forms and asynchronous ownership

The composer waits for a local execution start acknowledgement before clearing
its draft. This is not a promise of a completed or verified model answer. A
recoverable conversation-creation failure preserves both text and comparison
mode. If the user types a follow-up while creation is pending, admission clears
only the exact submitted draft; the later text remains.

The conversation model still locks admission synchronously. A pending creation
captures both its selection epoch and navigation revision. Obsolete completions
cannot switch a conversation, start a model run or show a stale error. Existing
execution IDs, cancellation, provider deadlines and single-reader rules remain.

Native document-filter and URL-import forms retain draft values on invalid dates
or recoverable server errors. Their errors use `aria-invalid`/`aria-describedby`
and localized copy. Drafts are not stored in logs, local durable storage or page
URLs. The existing API query transport is unchanged; this policy concerns page
navigation, not a claim that no authorized API ever receives a search query.

## Verification and rollback

Focused tests exercise history, safe normalization/schema parity, shared listener
cleanup, workspace switching, answer/comparison retry, newer draft preservation
and import errors in desktop/tablet/mobile profiles. Existing streaming/history,
performance, FSD and API/security gates remain release requirements. Synthetic
sessions, documents and streams require no paid provider or real email.

Rollback restores the preceding application source. There is no database,
configuration or dependency migration and no new persistent draft format.
