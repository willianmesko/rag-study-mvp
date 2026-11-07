# Decision: one dependency graph tool for module boundaries

Status: accepted for implementation on 2026-11-07.

Use pinned `dependency-cruiser@18.7.2` for architectural dependency checks, with the existing TypeScript compiler providing a small check for computed dynamic imports. Keep the development and CI baseline on Node.js 24.x. Do not add Steiger or a second lint framework for this gate.

The temporary pilot compared `steiger@0.9.0` with `@feature-sliced/steiger-plugin@0.8.2` against dependency-cruiser on 14 fixtures and a copy of the actual frontend. Both detected forbidden static and literal-dynamic imports across layers and slices. Steiger did not detect runtime cycles and reported 110 sidestep errors for intentionally public Shared leaf modules. Dependency-cruiser accepted those modules and reported zero violations after the Public API migration. Its runtime/type dependency metadata also supported distinguishing type-only and mixed cycles from real runtime cycles.

The isolated installations, each including TypeScript 5.9.3, resolved 65 packages for Steiger/plugin and 44 for dependency-cruiser. Steiger's install warned that its transitive `tsconfck@3.1.6` is unmaintained. First/repeated frontend scans took 1,049/930 ms for dependency-cruiser and 1,174/597 ms for Steiger on the local Node 24.12.0 environment. Steiger needed polling in this restricted environment because filesystem watching failed; this is not an assertion that ordinary CI requires polling.

The approved project installation added 32 lockfile entries after deduplication, changed no existing package versions and added no runtime dependency. An npm advisory audit of the isolated dependency-cruiser/TypeScript tree on the audit date reported zero known advisories. This is a dated advisory check, not a guarantee against future vulnerabilities.

Use dependency-cruiser's `err` reporter for blocking checks: the pilot verified exit 1 for invalid fixtures, while its JSON reporter returned exit 0 even when the JSON contained errors. Run structural checks with type edges included and cycle checks against a separate runtime graph. Unwrapped literal dynamic imports are supported; computed imports cannot be resolved reliably by either piloted tool. The structural parser also missed a parenthesized literal target in the final probe. The existing TypeScript AST therefore rejects both computed and parenthesized targets.

The chosen tool does not enforce every FSD naming or folder convention. This gate protects dependency direction, slice Public APIs, slice isolation and runtime acyclicity. Add further structural rules only for a concrete defect, with fixtures and a documented exception policy.

Primary references: [dependency-cruiser rule conditions and type-only cycles](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md), [dynamic import limitations](https://github.com/sverweij/dependency-cruiser/blob/main/doc/faq.md), [official Steiger project and configuration](https://github.com/feature-sliced/steiger).
