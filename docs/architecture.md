# Architecture

`recorder-neoforge/` owns NeoForge event capture, sampling, identity/item registries, typed state deltas, the bounded writer queue, binary storage, retention, heatmap/activity derivation and public export. It has no BlueMap dependency, API reflection, map IDs, JavaScript or CSS.

`bluemap-addon/` owns browser protocol consumption, replay state, activity histogram, cached state reconstruction and BlueMap rendering. The strict TypeScript source is split by protocol, HTTP, state, layout, presentation, preferences and BlueMap adapter concerns. Esbuild emits one self-contained `player-history.js` bundle plus `player-history.css` into `dist/`; Vitest and Biome validate the frontend. The recorder exports resource keys such as `minecraft:overworld`; it never resolves BlueMap map IDs.

`bluemap-neoforge/` is the second NeoForge mod requested for deployment. It contains the viewer assets and a small BlueMap bootstrap. Only this module reflects BlueMap's Java API, installs assets, registers scripts/styles, creates the public-directory link and writes `integration.json` containing map-to-dimension mappings. It never reads the private recorder store. It can run without the recorder installed, using an existing protocol-v2 dataset.

Server callbacks capture bounded immutable values and offer them to a nonblocking queue. The single history worker writes registry metadata before flushing referencing records, forces and atomically publishes files, builds derived activity/heatmaps and performs retention. Dropped envelopes create explicit movement/state gaps. Inventory shares the state stream using per-slot keys, so it has the same checkpoint, recovery and retention behavior.

The authoritative layout remains compatible with previous releases:

```text
<world>/player-history/
  registry.json, settings.json, capabilities.json, publication.json
  tracks/<bucket>.bin            movement and sparse events, storage v1
  states/<bucket>.bin            typed state and inventory, independent v1
  heatmap/{chunk,hour,day}/      replaceable time-spent aggregates
  public/
    manifest.json               protocol v2, includes registries
    chunks/<bucket>.json
    states/<bucket>.json
    activity/<UTC-day>.json
    heatmap/{chunk,hour,day}/
```

The public directory can be elsewhere. JSON is transport/derived data; authoritative movement and state remain binary. Keeping existing paths avoids a destructive migration. `settings.json` prevents accidental chunk-duration or heatmap-cell-size reinterpretation.
