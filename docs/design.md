# Historical design notes

This document describes the original combined release. The current split architecture and protocol supersede it: see [architecture](architecture.md), [configuration](configuration.md) and [public protocol](public-protocol.md).

# Design decisions and API dependencies

Implementation order: binary recorder/session semantics first, optional publishing and replay second, then trails/events and time-spent aggregation. Initial unit tests preceded browser work. Local commits separate the recorder baseline from the complete web integration and subsequent validation fixes.

## Boundaries

- `Point`, `HistoryEvent`, `Sampler`, `BinaryCodec`, `Registry`, `HistoryQueryService`, `Heatmap` have no Minecraft dependencies.
- `HistoryStore` owns queueing, worker lifetime, chunk storage, publishing and retention. `HeatmapStore` owns derived persistence.
- `PlayerHistoryMod` owns server-thread snapshots, visibility eligibility and lifecycle callbacks. It never writes history files from a movement callback.
- `BlueMapIntegration` reflects only public Java API methods, avoiding any BlueMap classes in the recorder's runtime linkage. Missing BlueMap does not prevent loading the mod.
- `ReplayEngine` and `ChunkCache` are independent JavaScript modules. `BlueMapAdapter` is the only module that accesses BlueMap runtime rendering objects.
- `ReplayClock` owns the selectable rolling range (48 hours by default), absolute replay time, fixed custom date bounds, normal play/pause state, selected playback speed and temporary shuttle rate. The custom element owns controls, cancellable loading, and the 45-second manifest refresh. Recorder and raw query semantics are unchanged by the 0.2.0 UI redesign.

## Official sources reviewed

- [NeoForge 1.21.1 events](https://docs.neoforged.net/docs/1.21.1/concepts/events/)
- [Official NeoForge 1.21.1 ModDevGradle scaffold](https://github.com/NeoForgeMDKs/MDK-1.21.1-ModDevGradle)
- [BlueMap custom web integrations](https://bluemap.bluecolored.de/community/Customisation.html)
- [BlueMap WebApp Java API](https://github.com/BlueMap-Minecraft/BlueMapAPI/blob/master/src/main/java/de/bluecolored/bluemap/api/WebApp.java)
- [BlueMap web addon examples](https://github.com/TechnicJelle/BlueMapWebAddons), especially the distance-measurer's LineMarker usage
- [BlueMap webapp source](https://github.com/BlueMap-Minecraft/BlueMap/tree/master/common/webapp/src/js)

Current main-branch sources were reviewed for API direction, then the **actual BlueMap 5.7 NeoForge JAR** and running webapp were inspected to validate the 1.21.1-compatible API. No Bukkit integration APIs are used. The dependency baseline is NeoForge 21.1.248, ModDevGradle 2.0.146, Gradle 9.2.1 and Minecraft's Gson; JUnit 5.11.4 and Gson 2.10.1 are isolated test dependencies. The test client's npm packages are temporary verification tools, not shipped dependencies.

## Java APIs used

`BlueMapAPI.onEnable/onDisable`, `getWebApp`, `getWorld(Object)` with ServerLevel objects; `BlueMapWorld.getMaps`; `BlueMapMap.getId`; `WebApp.getWebRoot`, `registerScript`, `registerStyle`, `getPlayerVisibility(UUID)`.

The visibility method is marked experimental upstream and reports explicit BlueMap hidden-player state. It does not expose all rendering rules or every third-party vanish plugin. An absent provider uses Minecraft invisibility; an installed failing provider denies recording. Tests cover the distinction.

NeoForge uses server start/stop, post-server-tick, player login/logout/dimension/respawn, living death and command registration events. A required mixin observes the completed `ServerGamePacketListenerImpl.teleport(DDDFF, Set<RelativeMovement>)` method. Exact pre-teleport position and dimension are copied on entry; successful position changes create a server event on return. This avoids recording a canceled pre-teleport event as a completed teleport. The mixin descriptor is specific to Minecraft 1.21.1; other Minecraft versions need a port.

## Web APIs used

`window.bluemap`, `window.BlueMap`, `mapViewer.markers`, `mapViewer.map.data.id`, `mapViewer.controlsManager.position`; `MarkerSet`, `HtmlMarker`, `LineMarker.setLine`, marker `.position`, `.element`, and `BlueMap.Three` geometry/material classes.

These exported web runtime objects are more version-sensitive than the Java API. Their use is confined to `bluemap-adapter.js`. In BlueMap 5.7, removing a marker through MarkerSet already disposes it; the adapter must not dispose it twice. BlueMap's built-in webserver recognizes `.js` as JavaScript, so browser ES modules use that extension. Version query strings invalidate old browser assets after upgrades. BlueMap also caches served assets during a development run; restart/reload it after replacing resources.

The custom element's behavior is independent of BlueMap's Vue DOM. Styling inherits BlueMap's theme variables. One mobile-only CSS rule moves BlueMap 5.x's `#zoom-buttons` below the top toolbar while history is expanded, keeping them clear of the bottom transport; closing History restores their native position.

## Deliberate limits

No sample rate follows browser frame rate. Heatmaps integrate time rather than count samples, count AFK time, preserve player identity and never cross semantic gaps. Fine aggregate writes follow regular flushes; expensive hour/day rebuilds occur on rollover/close rather than every sample. Aggregate files remain JSON for inspectability in this first version; raw movement is compact binary.

Static publication is deliberately straightforward and unauthenticated. The query layer has bounded bucket selection and could back a future authenticated endpoint; it is not currently an HTTP server. Retention is coarse by UTC day, avoiding mixed-expiration daily aggregates. Changing structural storage settings is a new-dataset operation. Compression, automatic historical redaction, terrain-conforming heatmaps, container events and trajectory simplification remain future work.

Player colors derive deterministically from stable registry IDs. The BlueMap adapter owns an isolated hover tooltip and raycasts its own trail geometry; event hover details use textContent and remain plain text. Tooltip listeners and DOM are removed when history closes. Trail duration loading uses the existing bounded cache, reads the necessary time buckets, and preserves breaks across missing chunks.

The activity histogram uses derived per-UTC-day minute counts, published by the existing writer and historical backfill. Replacing a chunk removes its previous counts before adding its current non-context points, preventing repeated flushes from double-counting. Retention prunes activity days with other public history. This adds no reads to the Minecraft tick path. The frontend fetches daily summaries, aggregates to at most 96 bars, cancels obsolete range requests, and identifies incomplete indexing.
