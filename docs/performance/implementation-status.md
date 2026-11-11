# Performance implementation status

Snapshot after the implementation drafts on 2026-11-10. Deployment and production acceptance are separate from code delivery.

| Work | Deliverable |
|---|---|
| Live/chat independent of history, summary-first histogram, replay/follow and underground fixes | Player History merged #66 |
| Versioned ESM bootstrap and deferred historical engines/analytics | Player History merged #67 |
| Cross-dimension roster/global heads, live-only offline locations | Player History merged #68 |
| Follow across map transitions and compact desktop/mobile roster | Player History merged #70 |
| Core identity/revalidation, geometry retry and demand admission | BlueMap3D merged #87 |
| Early live scripts and map transition readiness | [BlueMap #5](https://github.com/fpbcraft/BlueMap/pull/5) |
| Retained texture migration and safe publication | [BlueMap draft #6](https://github.com/fpbcraft/BlueMap/pull/6) |
| Shared terrain budgets and tile failure cleanup | [BlueMap draft #7](https://github.com/fpbcraft/BlueMap/pull/7), stacked on #6/#5 |
| Settled transforms and partial instance uploads | [BlueMap3D draft #88](https://github.com/fpbcraft/bluemap3d-patches/pull/88) |
| Bounded history scans, shared cancellable reads and request deadlines | [Player History draft #71](https://github.com/fpbcraft/player-history-mc/pull/71) |

## New evidence

- Captured 32,449-entry texture gallery round-trips exactly, including PNGs, animation and ordinals. Initial gzip manifest: 18,619,202 -> 2,556,494 bytes (86.3% smaller). PNGs become separate lazy requests; this is not a page-load claim.
- Synthetic oversized range: 102 requests instead of all 5,000; isolated process RSS 114,688 -> 52,384 KiB. See `bounded-history-loading.md` and `tools/measure-history-range.mjs`.
- Actual TileManager under deterministic stalled IO: 32 -> 4 requests at 250 ms. This is a concurrency result, not faster-visible-terrain proof. Reproduce with BlueMap `common/webapp/benchmarks/terrain-request-burst.mjs`.
- Real pinned Three.js stationary fixture, 6,749 roots/5,000 instances: median CPU 3.715 -> 1.136 ms/frame. Zero steady-state instance update signals instead of one per frame. This isolates static transform cost, without rendering/feed/geometry work; see BlueMap3D `benchmarks/scene-transforms.cjs`.
- Frontend typecheck/lint/build and all 160 tests pass; Player History Java test/build and build/visual CI pass at `91e808f`. Candidate history plus terrain frontend pass the eight-player desktop/mobile Chrome regression with zero page errors. BlueMap core tests and CLI/NeoForge packaging pass. Full BlueMap3D build.sh and CI pass, including generated-runtime animation/instance regressions.
- Local review artifacts: `build/artifacts/map-implementation-6187aec5.zip`, including source commits and SHA-256 manifest. BlueMap contains #5/#6/#7; Player History contains #71; BlueMap3D contains #88's implementation. Nothing installed on the server.

## Still required

1. **Server work:** effective proxy/listener/cache configuration to diagnose chat 502s and apply MIME-correct compression, live cache bypass and static conditional handling. Host/tick/GC/disk profiles precede backend publication changes.
2. **Nether:** effective map config and reference locations to validate an interior mask while retaining real roof builds, then a controlled rerender. Browser changes cannot recover geometry absent from current tiles.
3. **Residual implementation:** further history UI/controller extraction (the shell remains eager), compatible spatial mob instancing/picking, and compact live transport are not implemented by these drafts. Workers/CDN/deltas and batching complexity need residual profiles after compression, migration and admission control.
4. **Release validation:** retained/exclusive storage-copy migration; matched cold/warm desktop/mobile timings; dense animated scenes, underground follow and dimension switching; real background/offline/restart recovery; designated-account authenticated chat; physical phones and a two-hour heap/resource soak. Focused fixtures do not substitute for these gates.
