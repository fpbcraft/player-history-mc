# Player roster and live offline locations

The follow bar is an all-dimension selector, separate from the active map's 3D players and markers. It starts as an strip of 22-pixel heads on a theme-matched translucent group background. Scrollbars are hidden while horizontal swiping remains available. The first click/tap expands the heads smoothly to 32 pixels and reveals full names; it does not start following a player. Selecting an expanded player preserves normal follow/navigation behavior. Clicking elsewhere or pressing Escape collapses the strip.

Desktop details use hover (plus keyboard focus for accessibility), never click-pinning. Touch-only devices use taps, with synthetic mouse hover ignored. The popup contains only HP or a compact last-seen time: no repeated name, dimension or online/offline label. Dimension stays on the head outline; offline skins are gray. Dates omit today's date, seconds and redundant current year. Activity text is absent. Expanded names use their natural width and can wrap, with horizontal scrolling for narrow displays instead of ellipsis. History uses the cursor's positions and historical telemetry, not live health.

Clicking a foreign-dimension online card retains follow intent and switches to the first configured map matching that dimension. The current map is retained when it already matches. If a dimension has multiple maps, the integration mapping's first entry is the fallback; there is no interior/roof preference setting yet. Ordinary avatar markers remain in their own dimension.

The recorder publishes optional `lastLocations` alongside both live snapshot formats. A compact file persists observed last positions on the existing background writer's normal flush cadence; it does not scan historical chunks or add main-thread disk work. The public list follows history retention. It starts with positions observed after this update is installed, rather than backfilling every former player. A restart does not turn these positions into online presence. Old servers remain compatible but cannot populate durable offline locations.

Offline entries show a last-recorded timestamp and omit health/actions. Their map markers are separate from 3D players and appear only in live mode, in the matching dimension. Clicking an offline card navigates to a fixed location rather than following a nonexistent entity. They are cleared immediately on entering history. Recorder and integration jars both need updating to get the durable offline feature; the remaining roster improvements work with the existing live protocol.

Roster work is limited to five refreshes per second (new live data and mode transitions refresh immediately). Unchanged cards retain their DOM and images through camera movement/interpolation. Focused UI/protocol, cross-dimension/live-history, existing follow regression, and writer-restart tests accompany this draft. Broad real-player/mobile/skin-change and performance validation remain pending.

## Nether interior on the FPBCRAFT BlueMap 5.7 fork

Edit the existing Nether map file under `config/bluemap/maps/` (use the file for map ID `world_the_nether`):

```hocon
max-y: 90
render-edges: false
remove-caves-below-y: -10000
ambient-light: 0.6
```

These are top-level settings for this 5.7 fork. They cut away terrain above Y=90, leave the cut open, and retain underground faces. Latest upstream documentation uses a newer render-mask format; do not copy that format into this fork. Then run:

```text
/bluemap reload
/bluemap force-update world_the_nether
```

Replace the map ID if yours differs. A full rerender is necessary for existing tiles to show the interior. The view excludes everything above Y=90, including roof builds; use a separate map with a distinct ID to keep a rooftop view. Lowering the cut can expose deeper tunnels but also removes more upper terrain. Nothing here changes the Minecraft world.
