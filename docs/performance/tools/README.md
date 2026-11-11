# Production performance capture tools

These are read-only investigation tools for `https://map.fpbcraft.com`. They do not deploy or optimize the addons. They generate substantial production traffic; the measured default desktop navigation alone completed about 143 MB in 35 seconds. Run serially and sparingly. `capture-scenarios.cjs` opens chat and sends session-status requests, but does not pair an account or send chat messages. The fault tools delay responses only in their isolated browser context and emulate offline only there.

## Reproduce

Requires Node, installed Google Chrome, and Playwright (the investigation used 1.60.0). Install dependencies into a disposable benchmark directory, not this project's dependency graph:

```sh
mkdir -p /tmp/fpb-map-benchmark
npm install --prefix /tmp/fpb-map-benchmark playwright@1.60.0
export PLAYWRIGHT_MODULE=/tmp/fpb-map-benchmark/node_modules/playwright
export PERF_EVIDENCE_DIR=/tmp/fpb-map-benchmark/evidence
node docs/performance/tools/capture-production.cjs
node docs/performance/tools/capture-scenarios.cjs
node docs/performance/tools/capture-fault-scenarios.cjs
```

Run from repository root. Chrome must be available as Playwright channel `chrome`. Mobile emulation uses 390×844/DPR 3, 500,000 B/s down, 125,000 B/s up, 80 ms added latency and 4× CPU throttling on the desktop host. It is not a physical mobile performance test. Baseline captures two independent cold/repeat-visit pairs per desktop/mobile profile, 35 seconds per navigation. Repeat visits share a browser context, not a fully guaranteed warm asset set; the workflow script additionally reloads the same page.

`capture-production.cjs` stores navigation/resource timings, response headers, sampled scene/heap counters, long tasks, rAF intervals, screenshots and full traces. Its `chatButton` field has a known wrong selector; ignore it. First tile is an availability event, not first presented frame. A 35-second sample can have many in-flight responses. The tool does not record partial wire bytes or `requestfailed`, so transfer totals are lower bounds and an ended resource entry does not certify successful decoding. These limitations are deliberately retained with the historical evidence; address them before creating release benchmarks.

`capture-scenarios.cjs` uses both real button clicks and the public `bluemap.switchMap()` API. Switch promise duration is not full visual completion. It records a short desktop session, forced-GC checkpoints, same-page reload, an extended mobile session and a 12-second delayed-manifest fault. Fault interception disables normal browser caching; do not compare its transfer total to baseline cache tests. Its final metadata is intentionally aggregate; request bodies, auth tokens and chat text are not collected.

`capture-fault-scenarios.cjs` tests chat initialization while historical chunks are delayed, closing history with chat still open, and short offline/reconnect recovery. The chat outage found during investigation means these checks primarily observe session request scheduling, not successful chat delivery.

`capture-underground-follow.cjs` profiles a specific existing production historical segment at `1794319284400`, player ID 2, Y=46, camera distance 100, then seeks backwards ten minutes. It uses the currently deployed unminified component's diagnostic properties and timing wrappers around existing methods. Those wrappers add overhead but preserve their return values. The segment may expire through retention, and application internals may change; choose an available controlled equivalent before future use. It does not contain a matched surface/follow-off control and cannot determine the underground-specific multiplier by itself.

```sh
node docs/performance/tools/capture-underground-follow.cjs
```

The initial underground attempt raced window loading and failed to obtain a point; it was discarded. The retained successful run waits for window availability. Future harnesses should wait on an explicit accepted-window mark rather than a fixed delay.

## Inspect evidence

`.json.gz` files are gzip-compressed JSON. Representative Chrome traces can be opened after decompression:

```sh
gzip -dc docs/performance/evidence/2026-11-10/desktop-1-cold.trace.json.gz > /tmp/desktop-map-trace.json
gzip -dc docs/performance/evidence/2026-11-10/underground-follow.cpuprofile.gz > /tmp/underground-map.cpuprofile
```

Import a trace into Chrome DevTools Performance; load the CPU profile in its JavaScript profiler. `summary.json` contains derived, reviewable baseline results and source/asset identities. Raw CDP counters use seconds for durations; browser ResourceTiming and wrapper values use milliseconds. Never add nested trace spans or CPU samples to wrapper wall times. `artifact-manifest.json` hashes the uncompressed bytes of retained files.

Future release instrumentation should add `requestfailed`, true first presented terrain and actual BlueMap-render frame intervals, online actor/asset readiness, bounded exclusive CPU spans, GPU queries where supported, endpoint publication age and real physical device coverage. See the report for the full acceptance matrix.

## Roster integration regression

`verify-player-roster.cjs` injects the locally built Player History modules and optionally a locally built BlueMap webapp into an isolated production-page browser context. Its player responses are synthetic; production player data and server configuration are not changed. It verifies three all-dimension cards, actual global skin loading, DOM reuse, foreign-dimension following through the real map switch, live offline navigation, narrow-screen control separation, and entering/leaving history. It records screenshots, page errors and a JSON report. It is a functional regression check, not a load-time benchmark or a real-online-player freshness test.

Build the Player History frontend first. Set `PERF_MANIFEST` to a retained protocol-v2 manifest fixture with the deployed dimension registry (the recorded scenario uses overworld ID 0 and Nether ID 1). Set `BLUEMAP_WEBAPP` to the companion BlueMap build's `common/webapp/dist` directory to exercise both proposed frontends. The browser still downloads the deployed terrain and object scene, so run sparingly and serially.

```sh
PLAYWRIGHT_MODULE=/tmp/fpb-map-benchmark/node_modules/playwright \
PERF_MANIFEST=/path/to/retained-manifest.json \
BLUEMAP_WEBAPP=/path/to/BlueMap/common/webapp/dist \
node docs/performance/tools/verify-player-roster.cjs
```

The historical seek uses the investigation's retained segment; replace it if it expires. Reports and screenshots default to `build/validation/player-roster/`.
