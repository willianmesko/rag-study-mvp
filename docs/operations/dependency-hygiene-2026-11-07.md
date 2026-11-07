# Dependency reachability and OCR build-artifact review

Reviewed on **2026-11-07** in the feature-module working tree based on
`c9b172967652d318f2294b5a76aa662a66eca057`. This is evidence for **BE-14**, not an
SDK upgrade or a runtime release. The current Supabase packages, lockfile,
application code and native OCR image smoke test remain unchanged by this review.

## Installed dependency evidence

The two workspace manifests, `apps/api/package.json` and
`apps/web/package.json`, both declare `@supabase/supabase-js: ^2.49.8`.
The root `package-lock.json` and installed package manifests agree:

| Package | Locked and installed | Relevant dependency |
| --- | --- | --- |
| `@supabase/supabase-js` | `2.49.8` | pins `@supabase/auth-js: 2.69.1` |
| `@supabase/auth-js` | `2.69.1` | `@supabase/node-fetch: ^2.6.14` |
| `@supabase/realtime-js` | `2.11.2` | SDK dependency; no finding in this audit |

The root Node engine is `24.x`; the API image uses `node:24-alpine` and the
review commands used Node `v24.12.0`. The previously completed Node-baseline item
is separate from the remaining SDK and packaging work.

A fresh `npm audit --omit=dev --json` reported **two low package entries, zero
moderate, high or critical entries**, across 278 production dependencies. These
are **one advisory through two dependency nodes**, not two independent flaws:

```text
apps/api + apps/web
  -> @supabase/supabase-js@2.49.8
     -> @supabase/auth-js@2.69.1
        -> GHSA-8r88-6cj9-9fh5 / CVE-2025-48370
```

The fresh report returned `fixAvailable: true`. An earlier cached response had
returned `false`; this flag must not substitute for inspecting the published
package dependency and vendor patch. The audit exits with status 1 because it
reports findings. This npm audit does not assess Alpine or native OCR packages.

## Advisory and application reachability

The [vendor advisory](https://github.com/supabase/auth-js/security/advisories/GHSA-8r88-6cj9-9fh5)
identifies path-routing problems when malformed identifiers reach the Auth admin
methods `getUserById`, `deleteUser`, `updateUserById`, `listFactors` or
`deleteFactor`. Its structured affected range is `<=2.69.1` and patched version
is `2.70.0`. The prose contains a conflicting `>=2.69.1` patch statement. The
structured version is consistent with the
[vendor fix PR](https://github.com/supabase/auth-js/pull/1063),
[merged fix](https://github.com/supabase/auth-js/commit/1bcb76e) and
[SDK 2.50.0 release](https://github.com/supabase/supabase-js/releases/tag/v2.50.0).

The application contains one use of an affected method:

- [`supabase-identity-gateway.ts`](../../apps/api/src/modules/identity/infrastructure/auth/supabase-identity-gateway.ts),
  line 77, calls `auth.admin.getUserById(id)` for directory entries.
- The same file defines `z.uuid()` at line 12 and rejects the entire invalid-ID
  batch at lines 66–67, before invoking the SDK. Inputs are IDs from verified
  workspace memberships. The adapter also rejects substituted response IDs and
  distinguishes a removed identity's 404 from a directory failure.
- Token verification uses `auth.getUser(token)`, an unaffected method, with
  separate non-persisting public and server-only directory clients. It does not
  authorize from browser role metadata.
- [`supabase-invitation-gateway.ts`](../../apps/api/src/modules/workspaces/infrastructure/auth/supabase-invitation-gateway.ts)
  uses `inviteUserByEmail`; no uses of the other affected admin methods were
  found in `apps/api/src` or `apps/web/src`.
- The browser's [`Supabase client`](../../apps/web/src/shared/lib/supabase.ts)
  uses its public configuration. Current sign-in is `signInWithPassword` in
  `pages/sign-in/ui/SignInPage.tsx`; logout explicitly uses `scope: "local"` in
  `app/model/use-application-session.ts`.

**Conclusion:** the affected library code is installed, but the reviewed
application's only affected sink has an input-validation mitigation. This
review did not demonstrate an exploitable application path. Preserve validation
when applying a vendor fix; a dependency audit finding and reachable exploit
are different observations.

### Executed sink proof

A temporary Node process loaded the installed SDK and the actual
`SupabaseIdentityGateway` through `node --import tsx`. All fetches were replaced
with in-memory fixtures: URL `https://auth-fixture.invalid`, synthetic public
and server keys, synthetic UUID `10000000-0000-4000-8000-000000000001` and
`fixture@example.test`. It read no project secret and contacted no Auth server.

1. An unguarded installed SDK call to `getUserById("../../settings")` passed a
   path which normalizes to `/auth/v1/settings` instead of the intended admin
   user endpoint. The fixture normalized the requested URL with `new URL(...)`.
   It did not execute a real settings operation.
2. The application's directory adapter was given `../../settings`,
   `10000000-0000-4000-8000-000000000001/../settings` and `%2e%2e%2fsettings`.
3. All three promises rejected before any application fetch. Assertions checked
   the normalized raw-SDK path and the zero-call count.

Observed output:

```json
{"rawSdkNormalizedPath":"/auth/v1/settings","applicationRejected":3,"applicationNetworkCalls":0}
```

The existing
[`supabase-identity-gateway.test.ts`](../../apps/api/src/modules/identity/infrastructure/auth/supabase-identity-gateway.test.ts)
also covers token concurrency, metadata distrust, invalid versus unavailable
Auth, deadline and response-size limits, directory-only lookup, bounded member
concurrency, deleted identities and response-ID substitution. The temporary
proof adds advisory-specific reachability evidence; it is not a committed
regression test or a live Supabase integration test.

## Smallest compatible vendor candidate

Public registry metadata was read without installing packages:

| SDK version | Pinned Auth | Pinned Realtime | Assessment |
| --- | --- | --- | --- |
| [`2.49.9`](https://registry.npmjs.org/@supabase/supabase-js/2.49.9) | `2.69.1` | `2.11.9` | affected Auth remains |
| [`2.49.10`](https://registry.npmjs.org/@supabase/supabase-js/2.49.10) | `2.69.1` | `2.11.10` | affected Auth remains |
| `2.49.11` | — | — | registry returns 404 |
| [`2.50.0`](https://registry.npmjs.org/@supabase/supabase-js/2.50.0) | `2.70.0` | `2.11.10` | smallest reviewed stable SDK fix |

The [`auth-js@2.70.0` metadata](https://registry.npmjs.org/@supabase/auth-js/2.70.0)
and official SDK release agree. Relative to the installed SDK, `2.50.0` updates
Auth and Realtime while retaining the same Functions, PostgREST, Storage and
node-fetch versions. A narrow, explicitly reviewed SDK update for both
workspaces is preferable to overriding the old SDK's exact Auth dependency.
A jump to a much newer SDK is a separate migration decision, not necessary to
address this advisory.

The public
[npm advisory bulk endpoint](https://registry.npmjs.org/-/npm/v1/security/advisories/bulk)
returned `{}` for this exact candidate set:

```json
{"@supabase/auth-js":["2.70.0"],"@supabase/supabase-js":["2.50.0"],"@supabase/realtime-js":["2.11.10"]}
```

This checks only those package versions. No candidate lockfile was resolved or
installed, and no claim is made that an unbuilt candidate dependency tree has
passed a complete audit. Retain the current lockfile until the upgrade decision
and its bounded implementation are authorized; do not run `npm audit fix` as a
substitute for that review.

### Migration risks and objective acceptance

The vendor patch enforces UUID v4 for the affected admin arguments and validates
sign-out scope. The application currently accepts UUIDs through `z.uuid()` and
its fixtures use v4. If imported or custom non-v4 Auth users exist, their member
directory behavior needs verification; this review did not find evidence of
such users. Realtime also changes, so the upgrade is not an Auth-only binary
replacement. A package rollback requires restoring both manifests and the lock,
not a database migration.

Before calling the SDK task complete:

1. Review the exact manifest/lock diff for both workspaces and perform a clean
   install. Keep unrelated dependency changes outside this patch.
2. Commit a regression proving traversal/encoded/mixed malformed directory IDs
   cause no request. Retain existing Auth deadline, token-concurrency, directory
   response and workspace RBAC/isolation behavior.
3. Test sign-in success and invalid credentials, session restoration/refresh,
   local/cross-tab sign-out and account-switch private-cache cleanup. Verify
   the server invitation path with an SDK fixture; real mail is unnecessary.
4. Run API/frontend strict checking, production builds, focused Auth/MCP/session
   tests and required release checks. Re-run the audit on the actual new lock.
5. Publish the tested source through the existing release gates, recording the
   deployed SHA separately from local package verification.

## Native OCR test-artifact separation

[`apps/api/tsconfig.json`](../../apps/api/tsconfig.json) includes all
`src/**/*.ts`, including colocated tests and test helpers. The
[`API Dockerfile`](../../apps/api/Dockerfile) copies that complete compiled tree
at line 28. This is intentional today: line 31 runs
`modules/ingestion/infrastructure/extraction/pdf-ocr.native.test.js` inside the
actual production dependency/native-tool environment as the unprivileged user.

The native test imports the production extractor and OCR adapter plus the
synthetic `pdf-test-fixture` helper. With
`PDF_OCR_SMOKE_LANGUAGES=eng+por`, both native cases are enabled: mixed native/
scanned page ordering and Portuguese scanned-text recognition. They verify
Poppler/Tesseract and language data rather than a simulated OCR implementation.
No observed route exposes compiled test files. The issue is runtime-artifact
hygiene, not an established document-data leak.

**Do not simply exclude or remove all tests from the current build:** that would
break or silently weaken the mandatory image smoke. An incremental design using
the existing TypeScript and Docker tools is:

1. Produce a clean runtime output from explicit supported roots: server,
   supported CLI/worker entries and stable MCP stdio entry. Let TypeScript
   follow their transitive imports. Verify required assets and operational
   command paths rather than assuming every current `dist` file is runtime.
2. Build a separate smoke artifact retaining the two native cases and synthetic
   helper. It must import the exact production JavaScript to be shipped, not a
   second independently compiled copy of the implementation.
3. Create a shared runtime base with `npm ci --omit=dev`, the same Poppler,
   Tesseract and `eng`/`por` data. Run smoke in a verification stage based on that
   environment, as `USER node`, with both cases required and zero skips.
4. Build a fresh final stage from that runtime base, copying only the verified
   clean runtime tree from the verification stage. The final build dependency
   must require smoke success so it cannot be pruned as an unused Docker stage.
   Removing tests in a later layer of a test-containing final image would leave
   their bytes in earlier layers.
5. Inspect the final image for absent `.test.js`, their maps and the synthetic
   fixture helper; verify runtime imports, supported entry paths, health and
   actual ingestion. Record image-size evidence before claiming improvement.

An `exclude` pattern alone does not prevent TypeScript from compiling an excluded
file if a runtime root imports it. A clean output directory and a final artifact
inventory should enforce the intended boundary. The current dashboard's default
evaluation suites are embedded in application code; they are not evidence of a
missing external JSON asset. No extra build library is needed for this design.

## Remaining status

The advisory reachability and compatible-candidate analysis are complete.
The SDK update, committed advisory regression and production/smoke artifact
separation remain **pending**. This evidence changes no package version,
deployment, database schema, credentials or OCR activation.


## Artifact implementation follow-up

The runtime/smoke separation now has a locally verified candidate using the same
compiler, Node runner and Docker tooling, with explicit roots and mandatory two
real OCR passes. The [release record](release-2026-11-07-runtime-artifacts.md)
records artifact sizes, final-image inspection, current CI/publication status and
the local Docker capacity limitation. The dependency update remains separate.
