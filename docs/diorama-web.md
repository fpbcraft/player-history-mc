# Player History on Diorama

This integration consumes the same protocol-v2 public dataset as BlueMap. The
recorder, binary history, state tracking and retention settings are unchanged.
No recordings should be moved or deleted. Keep BlueMap at `/` during migration.

## Automatic JAR deployment (replaces manual asset copying)

**Requires the matching Diorama Java extension host** (fpbcraft/diorama#12) and
Player History's public-assets JAR from the corresponding release (fpbcraft/player-history-mc#78).
The original v3.0.0 JAR does **not** contain this auto-installer.

1. Install/update Diorama, `player-history-recorder`, and `player-history-public-assets`
   to versions containing these changes. If you use BlueMap, install the matching
   `player-history-bluemap` JAR as well. Avoid mixed old/new Player History JARs.
2. Leave the recorder's `publishing.enabled=true` and
   `publishing.public-directory=player-history/public` (or your existing
   intentionally public export). No recordings need moving or copying.
3. Restart Minecraft, then refresh the Diorama map. **Do not create or copy
   `extensions.json` or any JS/CSS/modules.** They are registered at startup
   and served directly from the JAR.
4. Test these URLs on the map's existing origin (port 8100 by default):
   - `/extensions.auto.json` contains `/player-history/diorama-history.js`
   - `/player-history/diorama-history.js` is JavaScript (HTTP 200)
   - `/player-history/player-history.css` is CSS (HTTP 200)
   - `/player-history/data/manifest.json` is the recorder's public protocol v2 manifest
   - `/player-history/data/presence.json` is a live public snapshot when one is available

### How this works

The JAR bundles its own `diorama-history.js`, stylesheet and versioned modules.
Diorama's read-only web extension registry serves exactly the packaged filenames
without extracting them to the map folder. A second, **virtual**
`extensions.auto.json` manifest adds the scripts/styles to the viewer. Any
user-maintained `extensions.json` is respected and deduplicated, not overwritten.

The registry separately exposes the recorder's **public export only** under
`/player-history/data/` and the current public skin/overlay publisher under
`/player-history/`. Requests are confined to those roots, reject symlinks and
traversal paths, and are read-only. No private recorder data, sessions or
`webchat-sessions.json` is mounted. Published history is not duplicated.

When BlueMap is present, its bridge still owns skin and server-overlay publishing.
Diorama reads the **existing** BlueMap output; a second publisher is never
started. Diorama-only servers use the public-assets module's existing standalone
publisher and settings (`config/playerhistory_assets-common.toml`).

### Chat and HTTPS

If `webchat.enabled=true` and `webchat.bind=127.0.0.1`, Diorama registers a
strictly bounded same-origin `/player-history-api/` route to the recorder's
existing loopback chat server (`webchat.port`, default 8101).
Only supported chat operations are proxied; it cannot access arbitrary hosts
or filesystem paths. If chat is disabled or bound elsewhere, this route is not
registered.

**Deploy an HTTPS reverse proxy before using authenticated browser chat on an
untrusted network.** HTTP directly on port 8100 does not encrypt pairing tokens.
The read-only public replay/history features do not depend on chat being enabled.

### Existing deployments and troubleshooting

The old v3.0.0 deployment requires manually staged frontend files and a proxy.
After upgrading both JARs/mods to this implementation, stale manually copied
`world/diorama-web/player-history/` files may be left in place temporarily.
The JAR's registered resources take precedence, so they cannot override the new
bootstrap. Remove old copies only after confirming the new routes work.

If `extensions.auto.json` is empty, verify that Diorama and public-assets are
both running updated builds. If the JS loads but history is unavailable, check
`publishing.enabled`, the public export directory and
`/player-history/data/manifest.json`. If the roster/skin overlays are missing,
check for `/player-history/server-overlays.json` and
`/player-history/skins/<uuid>.png` (when known).

## Manual staging (optional, for external static hosting)

Manual `node scripts/prepare-diorama-web.mjs --output NEW_DIRECTORY` deployment
remains available for external hosts that deliberately do not run Diorama's
embedded web server. Build the frontend using Node 22+ first with
`npm ci --prefix bluemap-addon` and `npm run build --prefix bluemap-addon`.
The staging script refuses existing output folders and contains only static
assets, not history data.

For HTTPS frontends outside Diorama's embedded server, route
`/player-history/data/` to **only** the public recorder export, serve
`/player-history/` from the publisher's public asset root and proxy
`/player-history-api/` to localhost:8101 if chat is desired. The recorder's
private root must never be used as a static web root.

## Features

Both hosts share the replay panel, engine, cancellation, caches, live smoothing,
range presets and date selection, timeline, speeds, selection, event filters,
activity histogram, telemetry and web chat pairing/session flow. Diorama uses
local skin heads and a composited canvas. An optional WebGL layer is loaded only when vehicle geometry is available.
Roster clicks follow players across available mapped dimensions; map interaction
or Escape stops following. Offline markers show their last-recorded timestamp.
Unknown players do not get invented names or positions. Missing skins use the
bundled fallback head. Historical trails retain recorder breaks and dimensions.
Event details are plain text and never insert recorded HTML into the page.

The overlay menu reads the existing OPAC/loaded/forced/entity snapshots and world
clock. Heatmaps and X/Z chunk aggregates explicitly use an approximate Y=64
reference plane, labelled in the menu; they are not terrain-conforming. Player
and event coordinates always use their recorded Y, facing and active pitch.

Live vehicles consume the existing same-origin `/assets/bluemap3d/entities3d.json` publication. Create trains and Sable ships use its BM3D meshes and textures, with interpolated transforms and supported mechanical animation nodes. Recorded poses use the existing object replay engine and archived geometry, with the same renderer. Missing/unsupported geometry or WebGL falls back to labelled accessible icons. Opening the map does not fetch the complete geometry archive.

Set Diorama's `web-map-depth=true`, restart, and force-render existing terrain for occlusion. Keep `web-map-update-seconds=30` (or 60). Depth uses compressed camera-distance sidecars; at distant zooms or where sidecars are missing, vehicles render without terrain occlusion. The terrain keeps Diorama's facing/pitch; free camera rotation, vehicle shadows, animated recorded instance groups, terrain-conforming heatmaps, underground cutaways and Nether interior layers are not implemented here.

The renderer limits concurrent model loads to two, caches at most 16 models with a 128 MiB decoded-resource budget, and displays at most 128 nearby vehicles. Depth loads are also bounded and obsolete requests are cancelled. Vehicle feeds older than 15 seconds are hidden; feeds must include `generatedAt` or an accurate HTTP `Last-Modified`. Missing feeds back off to 30-second polling. Live polling pauses in historical mode and hidden tabs.

During coexistence, serve BlueMap3D's public `assets/bluemap3d/` directory at the same path on the shared HTTPS origin, with fresh JSON and revalidated model files. Never alias its parent or private recorder storage. The vehicle publishers and object geometry archive still depend on the existing BlueMap3D integration; the independent public-assets JAR does not replace those providers. No second server sampler is added by this frontend.

## Independent public publishers

Install the existing recorder plus `player-history-public-assets-<version>.jar`
for a Diorama-only server. `config/playerhistory_assets-common.toml` sets:

```toml
web-root = "player-history-web"
```

Relative roots resolve under the world directory; the module refuses overlap
with private recorder storage. It publishes under `<web-root>/player-history/`.
Existing overlay, equipment resolution and compatibility mappings are extracted
from the BlueMap bridge; the equipment override filename remains
`config/playerhistory_bluemap-equipment.json` for compatibility. Skins use the
online profile's standard Minecraft texture URL without network I/O on ticks;
previously published assets remain available for offline players. Missing or
unsupported offline/custom skin providers degrade to the fallback head.

When the BlueMap bridge is installed, it alone owns these publishers and retains
its existing paths and configured SkinProvider. **The updated bridge requires
the public-assets JAR too.** Use the existing BlueMap asset root in the nginx
route during coexistence; do not run a second publisher instance.

## Validation and remaining acceptance

```sh
npm run check --prefix bluemap-addon
DIORAMA_ROOT=/path/to/diorama CHROME_BIN=/path/to/chrome \
  node bluemap-addon/diorama-visual-test.mjs
./gradlew :public-assets-neoforge:build :bluemap-neoforge:build :recorder-neoforge:test
```

Browser fixtures exercise live movement, tile isolation, history, tooltips,
dimension following, pan/zoom, touch, high DPI, viewport overflow and cleanup.
The fixture also checks real vehicle pixels, terrain-depth occlusion, model-cache isolation during terrain revisions and archived-model playback. Screenshots/results are written under `bluemap-addon/visual-output/diorama/`.
They use clearly labelled synthetic terrain and do not prove real terrain alignment.

The user is testing the merged changes at `192.168.0.31:8100`. No hybrid artifacts have been deployed by this change. Real OPAC/MineColonies/Create/Sable acceptance and
production proxy validation remain required before merging or deploying.
