# Historical module loading — first draft

Stacked on PR #66. The registered classic script remains a small bootstrap. It loads the versioned live ESM entry; object replay, historical state lookup and analytics loaders are dynamically imported when historical data is requested. Shared code remains in a shared module rather than duplicating the renderer or Preact.

The activity summary starts independently of the historical module and object manifest. Live collection does not await the import. Failed historical imports can be retried on a subsequent request. The initial UI shell remains in the live module; this is an engine/analytics split, not a claim that every history control has been extracted.

The build emits a module asset index, enforces the initial static dependency graph budget, and packages every JS module in the integration JAR. Modules install before their versioned bootstrap; old module directories remain available to already-open pages. The development proxy serves the complete module graph with no-store headers.

A local build reports roughly 155 KB of initial modules plus a 254-byte bootstrap, with a further 15.6 KB historical entry deferred. These are build-byte measurements, not page-load timing results. Module requests add dependency edges; browser cold/warm/mobile measurements remain pending after early review.

Focused checks: TypeScript/build, history/live readiness regressions, bootstrap/module graph checks, development proxy module serving, and the integration module's compilation/packaging/path-validation tests. Broader performance, reconnect/import-failure and physical device validation remain review follow-ups. No deployment occurs in this PR.
