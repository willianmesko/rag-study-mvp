# BE-14 clean runtime artifacts with mandatory native OCR

## Status

The artifact-separation increment is **published on frontend and API** at
`d2882699695a02ce9c41be541832501034411db0`, after all four
[CI gates](https://github.com/willianmesko/rag-study-mvp/actions/runs/42422892309) passed. BE-14 remains partial: the separately reviewed Supabase SDK
update has not been installed. Dependency versions, credentials, database schema
and application behavior are unchanged. The previous verified runtime is
`2e6a4281fecb8fa55d6aa69e589d48a62999599a`.

## Concrete boundary and design

The old API compiler included every colocated test, its maps and the synthetic
PDF helper. The deployment image deliberately depended on that tree to run real
Poppler/Tesseract tests. Excluding files without replacing that verification would
weaken the release. The change uses existing TypeScript, Node and Docker:

1. `tsconfig.runtime.json` declares 14 supported roots: server, migrations, MCP
   stdio and the 11 existing CLI/worker entries. TypeScript follows their imports.
   `typecheck` retains the complete source/test project. Unit/PG tests use their
   existing source runner; no test is removed from those suites.
2. A native build script cleans only the generated `apps/api/dist`, compiles those
   roots and inventories the actual result. Missing entries, test/helper files,
   test-runner imports or symlinks fail the build. The compiler roots are the
   single source for the inventory's expected entries.
3. A separate compiler output produces the two native smoke cases and synthetic
   PDF helper. Only their two JavaScript files are added temporarily alongside
   the exact production extractor/OCR implementation to be shipped.
4. A verification stage shares the production Node/dependencies/Poppler/Tesseract
   base and runs as unprivileged `node`. It forces English and Portuguese, requires
   exactly two passes/zero skips, then removes the two added files and inventories
   the cleaned tree again. Timeout, failure or skipped cases block the build.
5. The fresh final stage copies only that verified clean tree and contracts. It
   inherits no test-containing verification layers. Root ownership of production
   code is restored; the running `node` user cannot write it. The copy depends on
   successful native verification, so BuildKit cannot prune it as an unused stage.

The maintained and compatibility API Dockerfiles share these stages. The MCP
Docker builder receives the same compiler/script files; its existing minimal
stdio runtime recipe and permission flags remain unchanged. No new build
framework, filesystem privilege, dependency, provider or runtime service is added.

## Measured local artifact evidence

The prior emitted API tree had **684 files / 2,849,437 bytes**, including **190
project test/helper artifacts / 1,322,040 bytes**. The candidate emits **486 files /
1,525,686 bytes**, preserves all 14 roots and has **zero project test artifacts**.
Some unreferenced non-test modules also stop being emitted. These are local
JavaScript/map tree sizes, not compressed image transfer, memory, startup time or
provider savings. No full-image before/after speed/size improvement is claimed.

The final local Linux arm64 image is
`sha256:5581e09f8db67b10095cf924a6312d355c9335916f8dec9df69d51c20935ffcb`,
528,815,608 bytes, Node 24.22.2. Both real OCR cases passed with zero skips in its
verification stage. Inspection found no project tests/maps/PDF helper in the final
application tree; UID 1000 cannot write the root-owned production entries. With
synthetic Auth settings and a disposable database, health/OCR returned 200 and
three private endpoints returned 401. Graceful shutdown exited 0 without OOM.
This image identifies a local candidate, not an immutable published-source build.
The Render build must verify its actual amd64 runtime independently.

## Other checks and local resource limit

- Three native artifact/receipt cases passed: required entries/test imports,
  symlink refusal and mandatory two-case/zero-skip OCR receipts.
- All seven local evaluation-harness checks passed with required process access.
  Native route-state/payload checks and architecture remain release requirements.
- The prior application source passed 85 real PostgreSQL cases and the isolated
  cutover locally and in CI. The packaging candidate's repeat hit the local
  Docker VM's full filesystem: 4 cases passed, 28 failed during setup/recovery
  with `No space left on device`; it did not complete the 85-case suite. This is
  not a passing candidate database run and no acceptance gate was weakened.
- Only 26 exact private build-cache IDs created by this task were removed, reported
  as 1.073 GB reclaimed. No image, volume or user container was deleted. The
  disposable database was stopped. The local VM remained space-constrained, so
  the final database proof must come from the complete fresh CI fixture.
- The dedicated MCP image was not rebuilt locally after that resource limit;
  its supported stdio/worker artifacts and protocol/permission behavior remain
  required in the fresh CI suite. The full API image and actual OCR were built.

Third-party package contents are outside the project-artifact inventory. No
claim is made that every dependency contains no upstream tests. No real user
content, paid provider, notification or production credential was used locally.

## Exact-source production receipt

| Service | Deployment | Observed live at UTC |
| --- | --- | --- |
| API | `dep-dbnqt7c9v7es73dh0jng` | 2026-11-07 23:07:02 |
| Frontend | `dep-dbnqt8qjnfac73d4nc4g` | 2026-11-07 23:06:05 |

Fresh remote-head/queue checks and four green jobs preceded manual deployment.
CI passed 410 UX checks/46 intentional profile skips, **85 PostgreSQL checks with
zero skips**, the isolated cutover with zero skips, 78 architecture fixtures,
seven harness checks, four native route-state, three artifact and three payload
cases. The fresh CI database resolved the local validation limitation; the local
failure record above is retained rather than relabeled as a pass.

The actual Render build recorded **two native OCR passes / zero skips** at
23:05:42 UTC, then its final-stage copy used the verified tree. Its receipt
matched **486 files / 1,525,686 bytes / 14 entries / zero test artifacts**.
This is independent production-build evidence from the local arm64 image.

Public checks at **23:08:07 UTC** confirmed frontend 200, entry
`/assets/index-B-Qgg-J_.js`, application chunk
`/assets/WorkspaceSwitcher-OP4Wzwjj.js`, semantic CSS and unchanged original icon
bytes. API health was 200 with OCR/durable workflows/conversations enabled;
correlation stayed server-owned. Private conversations/MCP/alerts were 401, and
OAuth resource/S256 plus sanitized 400/415 rejection remained intact.
The API error/fatal query for **23:07:02–23:08:33 UTC** returned no records.
No real private data, paid provider, notification or third-party consent was
exercised by public smoke checks. Those authorized paths retain fixture evidence.

## Remaining BE-14 and rollback

The compatible Auth advisory fix is still a separate dependency decision; this
increment neither installs it nor closes that part of BE-14. See the
[dated review](dependency-hygiene-2026-11-07.md).

Rollback restores the preceding build/compiler/Docker source together; no schema
or environment rollback is required. Both builds preserve the supported runtime
entries. Native OCR success remains mandatory on either route.
