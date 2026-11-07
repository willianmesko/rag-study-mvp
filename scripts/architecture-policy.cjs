const web = "apps/web/src";
const api = "apps/api/src";
const contracts = "packages/contracts/src";
const sourceRoots = [web, api, contracts];
const testFilePattern = "\\.(?:test|spec)\\.[cm]?[jt]sx?$";
const layers = ["app", "pages", "widgets", "features", "entities", "shared"];
const sliced = "pages|widgets|features|entities";
const modules = `${api}/modules`;
const platform = `${api}/platform`;
const workspaceAuthorization = `^${platform}/http/workspace-authorization\\.ts$`;
// HTTP authorization is the only platform adapter that consumes business types.
// Runtime imports remain forbidden by the separate erased-edge graph below.
const authorizationPublicTypes = `^${modules}/(?:identity|workspaces)/index\\.ts$`;
const moduleTransport = `${modules}/[^/]+/(?:infrastructure/|http/|[^/]+\\.(?:controller|module)\\.ts$)`;

const options = {
  tsConfig: { fileName: "apps/web/tsconfig.json" },
  enhancedResolveOptions: { exportsFields: ["exports"], conditionNames: ["import", "node", "default"] },
  // Preserve external edges, but do not walk dependencies or test implementations.
  doNotFollow: { path: `^(?!(?:${sourceRoots.join("|")})/)|${testFilePattern}` },
};

function structuralConfig() {
  return {
    forbidden: [
      { name: "web-no-api-import", severity: "error",
        from: { path: `^${web}/` }, to: { path: "^apps/api/" } },
      { name: "api-no-web-import", severity: "error",
        from: { path: `^${api}/` }, to: { path: "^apps/web/" } },
      { name: "contracts-no-application-import", severity: "error",
        from: { path: `^${contracts}/` }, to: { path: "^apps/" } },
      ...layers.slice(1).map((layer, index) => ({
        name: `web-no-upward-from-${layer}`, severity: "error",
        from: { path: `^${web}/${layer}/` },
        to: { path: `^${web}/(?:${layers.slice(0, index + 1).join("|")})/` },
      })),
      { name: "web-no-cross-slice", severity: "error",
        from: { path: `^${web}/(${sliced})/([^/]+)/` },
        to: { path: `^${web}/$1/`, pathNot: `^${web}/$1/$2/` } },
      { name: "web-no-private-cross-slice", severity: "error",
        from: { path: `^${web}/(${sliced})/([^/]+)/` },
        to: { path: `^${web}/(?:${sliced})/[^/]+/(?!index\\.tsx?$)`, pathNot: `^${web}/$1/$2/` } },
      { name: "web-no-private-from-unsliced", severity: "error",
        from: { path: `^${web}/(?!(?:${sliced})/)` },
        to: { path: `^${web}/(?:${sliced})/[^/]+/(?!index\\.tsx?$)` } },
      { name: "api-inner-layers-independent", severity: "error",
        from: { path: `^${api}/(?:domain|application)/` },
        to: { path: `^${api}/(?:infrastructure|interfaces)/` } },
      { name: "api-module-inner-layers-independent", severity: "error",
        from: { path: `^${modules}/[^/]+/(?:domain|application)/` },
        to: { path: `^(?:${moduleTransport}|${api}/(?:app|infrastructure|interfaces)/)` } },
      { name: "api-no-private-cross-module", severity: "error",
        from: { path: `^${modules}/([^/]+)/` },
        to: { path: `^${modules}/[^/]+/(?!index\\.ts$)`, pathNot: `^${modules}/$1/` } },
      { name: "api-module-public-api-no-composition", severity: "error",
        from: { path: `^${modules}/[^/]+/index\\.ts$` },
        to: { path: `^${modules}/[^/]+/[^/]+\\.(?:controller|module)\\.ts$` } },
      { name: "api-platform-no-module-import", severity: "error",
        from: { path: `^${platform}/`, pathNot: workspaceAuthorization },
        to: { path: `^${modules}/` } },
      { name: "api-platform-authorization-public-types-only", severity: "error",
        from: { path: workspaceAuthorization },
        to: { path: `^${modules}/`, pathNot: authorizationPublicTypes } },
      { name: "api-platform-independent-of-composition", severity: "error",
        from: { path: `^${platform}/` },
        to: { path: `^${api}/app/` } },
      { name: "production-does-not-import-tests", severity: "error",
        from: { path: `^(?:${sourceRoots.join("|")})/`, pathNot: testFilePattern },
        to: { path: testFilePattern } },
      { name: "no-unresolved-production-import", severity: "error",
        from: { path: `^(?:${sourceRoots.join("|")})/` }, to: { couldNotResolve: true } },
    ],
    options: { ...options, tsPreCompilationDeps: "specify", enhancedResolveOptions: {
      ...options.enhancedResolveOptions, conditionNames: ["types", "import", "node", "default"],
    } },
  };
}

function runtimeConfig() {
  return {
    forbidden: [
      { name: "no-runtime-cycles", severity: "error",
        from: { path: `^(?:${sourceRoots.join("|")})/` }, to: { circular: true } },
      { name: "api-platform-no-module-runtime", severity: "error",
        from: { path: `^${platform}/` }, to: { path: `^${modules}/` } },
    ],
    // Remove erased edges before computing cycles; do not filter a mixed graph afterward.
    options: { ...options, tsPreCompilationDeps: false },
  };
}

module.exports = { sourceRoots, testFilePattern, structuralConfig, runtimeConfig };
