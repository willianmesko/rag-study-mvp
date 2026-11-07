# Automated architecture checks

The architecture gate uses dependency-cruiser 18.7.2 and the TypeScript compiler already present in the repository. Development and CI use Node.js 24.x; `.nvmrc` selects that major version. There is no production runtime dependency on the graph checker.

`check:architecture` first builds the shared contracts, whose ESM/type exports
point at generated `dist` files. This keeps a clean checkout and CI consistent
with a developer checkout that already contains build output.

```bash
nvm use
npm ci
npm run check:architecture
npm run test:architecture
```

## Enforced boundaries

- Frontend and backend production code cannot import the other application's
  source or generated output. Both may consume shared contracts; the contracts
  package cannot import either application, including through type-only edges.

- Frontend dependencies follow `app → pages → widgets → features → entities → shared`. Lower layers cannot import higher layers, including through a type import.
- Different slices in the same sliced layer cannot import each other. Consumers of another slice must use its explicit `index.ts` Public API.
- Imports within a slice remain relative implementation imports. Shared is deliberately unsliced: its small public leaf modules can be imported directly. There is no giant Shared barrel.
- Backend business modules live in `apps/api/src/modules/<feature>`. Their `domain` and `application` code cannot import module infrastructure, HTTP helpers, controllers, composition factories, or application composition. The legacy root `domain`/`application` boundary remains enforced while transitional paths exist.
- A business module imports another business module through its `index.ts` Public API, including type imports, reexports and literal dynamic imports. Module factories do not have a cross-module bypass. Global `app` composition and its CLIs may wire private controllers and adapters; integration tests may exercise them directly because test filenames are outside the production graph.
- A business-module Public API cannot directly reexport a `*.controller.ts` or `*.module.ts` file. Keep public exports narrow and named: ports, policies, domain types and the services another module actually consumes. Exported symbol semantics still require review; a file graph cannot determine whether an arbitrarily named function is a composition factory.
- Generic `platform` code cannot import business modules or global application composition. The exact HTTP authorization type exception below is erased from the runtime graph; every platform-to-module runtime edge remains forbidden.
- Runtime dependency cycles fail a separate graph pass. Type-only or mixed type/runtime graph cycles do not masquerade as runtime cycles; type edges still participate in structural boundary checks.
- Dynamic imports must have an unwrapped literal string or a template literal without substitutions. The graph checker validates those edges; a small TypeScript AST check rejects computed or parenthesized targets instead of silently ignoring them. The pilot found that the structural graph misses parenthesized import targets, so the same restriction covers that syntax explicitly.

Production source roots are checked consistently by the command and its fixture tests. Fixtures verify that invalid architecture causes a nonzero process exit, rather than only checking for a warning in generated JSON. The CI uses the same commands as local development.

The resolver honors conditional ESM package exports and type-only export entries. Separate fixtures cover the SDK-style nested import export and Vite-style declaration export, so valid package subpaths do not require suppression.

## Public APIs and lazy loading

Consumed slices expose named exports only. Feature and entity implementations import their own internal modules directly, without importing their own slice barrel. The control-center Public API exports its container, while section implementations keep their individual lazy imports. Page APIs remain lazy in application composition.

The Public API increment added 20 consumed-slice indexes and rewrote 48 imports, retaining the four existing page APIs. A controlled build from disposable before/after source copies retained 21 JavaScript chunks and identical initial-entry size (526,222 raw bytes). Aggregate gzip size changed by 83 bytes with the same compression settings. This is a local fixture-build comparison, not a field-performance claim.

## Exceptions and remaining scope

No folder-wide suppression is permitted to hide a production boundary violation. Any necessary exception must identify the exact edge, explain why it exists, and have a fixture proving that nearby forbidden imports still fail. Test-file exclusion is an intentional scope distinction, not a license for production code to import test modules.

The only platform-to-business exception permits **type-only** imports from `apps/api/src/platform/http/workspace-authorization.ts` to these two Public APIs:

| Target | Purpose |
| --- | --- |
| `apps/api/src/modules/identity/index.ts` | Identity verification and request-identity contracts needed by the HTTP authorization adapter. |
| `apps/api/src/modules/workspaces/index.ts` | Membership repository and tenant-role contracts needed to authorize a workspace request. |

The structural pass rejects other platform source files, other feature targets and private implementation paths. The runtime-only pass rejects value imports even on these two exact pairs, including a mixed type/value dependency between the same files. This avoids treating a module-wide or mixed-edge exception as permission to execute business code from generic infrastructure. Fixtures cover each neighboring forbidden case.

The gate does not replace TypeScript checking, runtime authorization, response validation, UX tests or code review. It also does not dictate every FSD segment, rename slices based on convention alone, or infer the semantics of code. Generated dependencies and nonliteral module loading must not be added without updating the policy and its fixtures.

The initial migration aims for zero blocking violations, so no debt baseline is needed. If a later incremental migration needs one, dependency-cruiser's native baseline mechanism must be reviewed explicitly and restricted to named existing edges; a new violation must still fail. Steiger has no assumed native baseline in this project.

The [tool decision](decisions/0001-module-boundary-gate.md) records the pilot, measured compatibility, footprint and coverage limitations.
