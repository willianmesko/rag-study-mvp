# BE-08 / FE-08 native compiler checks

## Status and concrete findings

This bounded increment is validated and published at
`6032295e05d35626fcb4a2e62c730c26eae6715c`. The tickets
remain partial: these checks do not replace promise-aware or React Hooks lint.
No dependency, framework, API contract, stylesheet or visual baseline changes.

The installed TypeScript compiler was piloted with explicit return/fallthrough
checks on both workspaces and unused-symbol checks on the web workspace. It found
five concrete diagnostics:

| Location | Finding | Resolution |
| --- | --- | --- |
| API `extraction/extract-html.ts` | `findMain` mixed explicit returns and implicit falloff | Explicitly return `undefined` after unsuccessful traversal |
| Web `PipelineVisualization.tsx` | OCR lookup mixed explicit returns and implicit falloff | Explicitly return `undefined` when no current-attempt event exists |
| Web `QuestionAnswerForm.tsx` | Unused destructured `scope` | Stop binding it; preserve the existing prop contract |
| Web `OnboardingPage.tsx` | Unused destructured `justCreated` | Stop binding it; preserve the existing prop contract |
| Web `shared/api/rag-api.ts` | Unused local `QuestionResponse` type import | Remove only the local import; preserve the public re-export |

Both workspaces now enable `noImplicitReturns` and
`noFallthroughCasesInSwitch`. Web also enables `noUnusedLocals` and
`noUnusedParameters`; API already had those two options. Runtime and private OCR
compiler configurations inherit the API guarantees. Existing local and CI
typecheck commands use the same configurations, so new violations fail the
normal quality gate without another checker or extra script.

## Trade-offs and validation

The flags expose forgotten value-return paths, accidental switch fallthrough
and unused bindings. Explicit returns retain the previous `undefined` result;
removing unused bindings retains callers and exported contracts. They do not
establish absence of stale closures, floating promises or layout regressions.
Intentional fallthrough would need an explicit control-flow decision rather
than a broad compiler exception. No test was added to mirror these small edits.

All seven local harness checks passed, including strict types, existing unit
tests, production build, injection, golden set, replay regression and Promptfoo.
The guided-onboarding browser suite passed seven cases with eight intentional
profile skips: the complete new-team journey passed on desktop, tablet and
mobile, with the existing desktop-only extended flows retained. Snapshots and
assertions were not weakened. Full exact-source CI and matching live deployment
receipts are still required before this candidate is called published.

Both dependency graphs remain clean (450 structural modules / 1,773 edges,
449 runtime modules / 1,279 edges). The four native route-state and three
runtime-artifact checks also passed.

## Publication

All four [exact-source CI jobs](https://github.com/willianmesko/rag-study-mvp/actions/runs/42426577868)
passed: 410 UX cases / 46 deliberate skips, 85 PostgreSQL cases / zero skips,
the isolated cutover, 78 architecture fixtures, seven harness checks, four native
route-state, three artifact and three payload checks. The real restricted MCP
image also passed its five-tool/network-disabled/write-rejection check.

| Service | Deployment | Observed live on 2026-11-07 UTC |
| --- | --- | --- |
| API | `dep-dbnrj8psrm7s73a8c0j0` | 23:53:00.713176 |
| Web | `dep-dbnrja49v7es73dio35g` | 23:52:56.198813 |

The public smoke at 23:53:36 UTC confirmed the new served frontend assets,
original icon bytes, semantic action styles, API health capabilities, server
correlation IDs, private-route rejection and bounded OAuth handling. API
error/fatal logs were empty from 23:53:00 to 23:53:51 UTC. This does not claim a
completed real client consent or a paid-provider question.

Rollback restores the preceding source/compiler configuration. No data,
environment or dependency rollback is needed.
