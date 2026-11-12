# Player History on Diorama

This integration consumes the same protocol-v2 public dataset as BlueMap. The
recorder, binary history, state tracking and retention settings are unchanged.
No recordings should be moved or deleted. Keep BlueMap at `/` during migration.

## Build and prepare

Requires Node 22+ and Java 21 for Player History; Diorama's current build uses
Java 25. Diorama master includes the web API and progressive renderer (#6–#9). The hybrid terrain/depth branch is required for depth occlusion.

```sh
npm ci --prefix bluemap-addon
npm run check --prefix bluemap-addon
./gradlew test build
node scripts/prepare-diorama-web.mjs --output /tmp/diorama-web-review
```

The preparation command requires a new directory and never replaces a live site.
It stages the compiled viewer and an `extensions.json` configuration. The updated
Diorama viewer reads this optional file from its map directory; missing config
leaves the lightweight terrain-only viewer operational. Diorama preserves that
file when it rewrites its bundled page on startup.

For an authorized deployment, copy the staged `extensions.json` into the Diorama
map directory. Serve the staged `player-history/` files at `/player-history/`.
Use the public-assets JAR described below for skins and server snapshots. Keep
versioned `modules/` directories together with their bootstrap; remove older
versions only after old browser sessions have expired.

## One HTTPS origin

Example nginx routes, inside the existing map HTTPS server:

```nginx
# Keep the existing BlueMap root location.
location /diorama/ {
    alias /srv/minecraft/world/diorama-web/;
    add_header Cache-Control "no-cache";
}
# This is ONLY the recorder's public export, never its parent directory.
location /player-history/data/ {
    alias /srv/minecraft/world/player-history/public/;
    add_header Cache-Control "no-store";
}
location /player-history-api/ {
    proxy_pass http://127.0.0.1:8101;
    proxy_http_version 1.1;
    proxy_read_timeout 10s;
    client_max_body_size 4k;
}
# Assets may live in the existing BlueMap root during coexistence.
location /player-history/ {
    alias /srv/minecraft/world/player-history-web/player-history/;
    add_header Cache-Control "no-cache";
}
```

Place staged frontend files alongside the public assets in the final asset root.
For production caching, use a more-specific `/player-history/modules/` route
with `public, max-age=31536000, immutable`; leave bootstraps/styles revalidated
and live JSON at `no-store`. Diorama's embedded handler supports JS, CSS and PNG,
revalidates unversioned tiles, caches versioned tiles/modules immutably and never
follows a link outside its map root. It does not mount the recorder directory.
Reverse-proxy routes provide data access without weakening those protections.
Set Diorama's `web-map-port=0` for static serving, or use a free internal port
(e.g. 8102) with `web-map-address=127.0.0.1`. Leave BlueMap's port unchanged.

The public history docs also describe `presence.json` and `lastLocations`:
these existing protocol extensions are consumed without inventing online status
from historical locations. The public feed remains responsible for visibility
and exclusion. No second player position broadcaster is installed.

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
