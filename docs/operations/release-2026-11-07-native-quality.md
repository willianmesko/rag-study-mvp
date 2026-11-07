# BE-08 / FE-08 native compiler checks

## Status and concrete findings

This bounded increment is locally validated, not yet published. The tickets
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

Rollback restores the preceding source/compiler configuration. No data,
environment or dependency rollback is needed.
