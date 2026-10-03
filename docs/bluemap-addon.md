# BlueMap viewer installation and development

Install BlueMap 5.x and `player-history-bluemap-<version>.jar` in the server mods directory. For recording, also install the independent recorder JAR. The viewer mod's config is `config/playerhistory_bluemap-common.toml`:

```toml
public-directory = "player-history/public"
```

Match the recorder's publishing path. Relative paths resolve under the Minecraft world directory; absolute paths are allowed. The bridge installs assets in `<BlueMap webroot>/player-history/` and links `data` to the configured public directory. It writes `integration.json` and registers versioned script/style URLs during BlueMap enable/startup. Link creation requires filesystem symlink support and the web server must permit serving the link target.

For manual deployment, place the independent `bluemap-addon/dist/` contents in `<webroot>/player-history/`, link `data` to the recorder's public directory, provide `integration.json`, and register the script/style via BlueMap's addon configuration. Do not serve the private world/history directory. If the bridge logs a link failure, create the directory link using the host's filesystem tools and reload BlueMap. A reverse proxy or separate host can serve a copied public dataset with the same URL layout; keep retention synchronized there.

Frontend development requires Node and a running BlueMap site with a compatible Player History viewer JAR installed once. From the repository root, proxy either a local or hosted instance:

```sh
npm install --prefix bluemap-addon
npm run dev -- --target http://127.0.0.1:8100
npm run dev -- --target https://map.fpbcraft.com
```

BrowserSync prints and opens the local development URL on port 3000 by default; its HTTP or HTTPS scheme follows the target. Use `--port <number>` to choose another port and `--no-open` to leave the browser closed. To test from a phone on the same network, bind to every local interface and open one of the Phone URLs printed by the development command:

```sh
npm run dev -- --target http://127.0.0.1:8100 --host 0.0.0.0
```

The proxy loads the complete target BlueMap site, including map and live data, Player History data, web-chat requests and event streams. It replaces any registered stable or versioned `player-history*.js` and `.css` URL with the latest local build and disables caching for those responses. TypeScript and stylesheet changes rebuild automatically and refresh the page. A failed TypeScript build prints diagnostics and leaves the last successful bundle available. Playback preferences remain in local storage, and BlueMap's URL hash restores the camera after a full-page refresh.

This workflow never writes into the BlueMap webroot. UI-only edits need no JAR rebuild or Minecraft restart. Java, recorder, integration and production-release changes still require rebuilding the bridge JAR and restarting or reloading the server. The production build remains `npm run build`; Gradle packages the stable files in `bluemap-addon/dist/`, and the installed bridge creates its versioned copies.

Players use local skin-head markers without persistent names. Names, timestamps and available state appear on hover/focus. Events use compact SVG glyphs colored by event type, surrounded by player-colored rings, with no name pill. Click/Enter/Space opens event details without changing playback time. Trail hit testing uses BlueMap's Line2 intersections, retains timestamps alongside geometry, splits long geometry into at most 255-segment parts and coalesces pointer work with animation frames. Its dot sits at the same interpolated coordinate used by the tooltip. Escape, pointer leave, dragging and disposal clear the tooltip/dot.

Quick ranges include the recent-hour presets, today and yesterday, alongside an absolute local date/time range. Playback controls sit alongside the timeline on desktop and below it on mobile. Missing data remains empty in the histogram and does not create invented paths. Event/skin imagery and glyphs require no external image service.

The Events menu filters map icons and timeline event ticks by type. Preferences persist in the browser and do not change recorder settings. Icons are never shown before their timestamp; their lifetime follows trail duration (30 timeline seconds with trails off). Full-range mode retains events from the range start through the cursor. At most the latest 500 matching events are displayed.

The frontend build produces a single stable-named script and stylesheet inside the JAR. At installation, the BlueMap bridge derives the mod version and writes versioned web filenames such as `player-history-<version>.js`, preventing mixed cached module versions. The Gradle bridge build runs the frontend build and packages only those two generated files. Replace the previous BlueMap integration JAR, restart/reload BlueMap and refresh the page. Existing public protocol v2 history remains compatible; no history deletion is required.

Event tooltips resolve item/dimension IDs and nested positions into readable lines rather than JSON. Newly visible markers scale/fade in; retained markers are reused and do not restart animations on each update. Reduced-motion preferences disable animation. Historical state uses the actual cursor time; absent old telemetry is reported as not recorded. A bundled inline Steve-style head replaces unavailable local skin images.

## Live mode and compact controls (0.7.2)

Live follows current events and chat with approximately one-second polling. Native BlueMap player heads provide the live position; historical heads are hidden in Live to avoid duplicate positions. Scrubbing or starting playback switches to history. Live returns to a rolling range if custom dates were selected.

Clicking an event or trail opens its tooltip without moving the timeline. Event markers retain their identity during playback, so open tooltips persist. Each event type has a distinct icon color, surrounded by the player's color. New markers animate in; reduced-motion preferences disable that animation.

Item pickup/drop, block place/break and container-open are hidden by default in new viewer preferences. The Events menu enables them individually; saved preferences take precedence. Chat is enabled by default and also appears as readable recent messages.

The History panel remains fully expanded while open. Desktop playback controls share the timeline row; mobile places the same controls below the timeline in back, play, forward, NOW and speed order. Mobile spacing and widths are reduced to leave more of the map visible.


## Modded equipment compatibility

Player History resolves ordinary armor through Minecraft/NeoForge's armor material and per-item armor texture APIs. It also recognizes resource-backed custom humanoid geometry and segmented armor textures used by several armor mods.

Renderer-specific relationships that cannot be inferred from resource filenames are data-driven. Built-in mappings ship in the viewer JAR. Server owners can add or override mappings with `config/playerhistory_bluemap-equipment.json`:

```json
{
  "geometryAliases": {
    "examplemod:crimson_armor": "shared_knight_armor"
  },
  "textureAliases": {
    "examplemod:crimson_armor": "shared_crimson_texture"
  },
  "defaultArmorColors": {
    "examplemod:crimson_armor": "0x7A3E36"
  },
  "wearableSlots": {
    "back": {
      "parent": "torso",
      "position": [0.0, -0.36, -0.28],
      "rotationDegrees": [0.0, 180.0, 0.0],
      "scale": 0.78
    }
  },
  "wearableItems": {
    "examplemod:*_backpack": {
      "parent": "torso",
      "position": [0.0, -0.36, -0.28],
      "rotationDegrees": [0.0, 180.0, 0.0],
      "scale": 0.78
    }
  }
}
```

Armor alias keys are `<namespace>:<item-family>`; values are resource-family names without `geo/`, `textures/armor/` or file extensions. Item families strip the standard `_helmet`, `_chestplate`, `_leggings`, `_boots`, `_head`, `_chest`, `_legs` and `_feet` suffixes. `defaultArmorColors` supplies the undyed RGB color for dyeable armor whose client renderer uses a material-specific default; values may be decimal or hex strings such as `"0xA06540"`.

Curios integration is optional and reflective: the recorder records visible Curios as `curio:<slot>:<index>` when Curios is installed, including cosmetic-slot overrides. The viewer first checks `wearableItems` (exact IDs and `*` wildcard patterns), then falls back to the matching Curios identifier in `wearableSlots`. Supported parents are `head`, `torso`, `rightArm`, `leftArm`, `rightLeg`, and `leftLeg`. Positions are player-model units and rotations are degrees. Built-ins include common Curios attachment points, Create Engineer's Goggles, and Sophisticated Backpacks.

Use compatibility mappings only when a mod deliberately reuses a differently named geometry/texture or needs a nonstandard wearable attachment. Do not add mappings for armor that exposes the correct texture through NeoForge's `ArmorItem#getArmorTexture`; Player History honors that hook directly. A server restart or BlueMap integration restart reloads the override file.

When a newly observed armor item has not yet been published, the bridge retries unresolved armor descriptors every five seconds. The browser keeps the gray fallback only until a usable descriptor appears. This avoids permanently caching a transient miss while still leaving unsupported client-code-only embellishments as a graceful fallback.
