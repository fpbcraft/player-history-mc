# BlueMap viewer installation and development

Install BlueMap 5.x and `player-history-bluemap-0.7.2.jar` in the server mods directory. For recording, also install the independent recorder JAR. The viewer mod's config is `config/playerhistory_bluemap-common.toml`:

```toml
public-directory = "player-history/public"
```

Match the recorder's publishing path. Relative paths resolve under the Minecraft world directory; absolute paths are allowed. The bridge installs assets in `<BlueMap webroot>/player-history/` and links `data` to the configured public directory. It writes `integration.json` and registers versioned script/style URLs during BlueMap enable/startup. Link creation requires filesystem symlink support and the web server must permit serving the link target.

For manual deployment, place the independent `bluemap-addon/dist/` contents in `<webroot>/player-history/`, link `data` to the recorder's public directory, provide `integration.json`, and register the script/style via BlueMap's addon configuration. Do not serve the private world/history directory. If the bridge logs a link failure, create the directory link using the host's filesystem tools and reload BlueMap. A reverse proxy or separate host can serve a copied public dataset with the same URL layout; keep retention synchronized there.

Frontend development requires only Node:

```sh
cd bluemap-addon
npm test
npm run build
BLUEMAP_WEBROOT=/absolute/path/to/bluemap/web npm run watch
```

No npm dependencies are required. The watch task copies changed assets; refresh the browser to load them. No Minecraft restart is required for UI-only edits. BlueMap reload/startup reinstalls bundled assets, so rebuild the bridge JAR before distributing those edits.

Players use local skin-head markers without persistent names. Names, timestamps and available state appear on hover/focus. Events use compact SVG glyphs colored by event type, surrounded by player-colored rings, with no name pill. Click/Enter/Space seeks to an event. Trail hit testing uses BlueMap's Line2 intersections, retains timestamps alongside geometry, splits long geometry into at most 255-segment parts and coalesces pointer work with animation frames. Its dot sits at the same interpolated coordinate used by the tooltip. Escape, pointer leave, dragging and disposal clear the tooltip/dot.

Ranges include 1/3/6 hours, day, 48 hours, week, 30 days, N days, all history and custom local date/time. Playback speed is separate from the temporary ±120× shuttle. Missing data remains empty in the histogram and does not create invented paths. Event/skin imagery and glyphs require no external image service.

The Events menu filters map icons and timeline event ticks by type. Preferences persist in the browser and do not change recorder settings. Icons are never shown before their timestamp; their lifetime follows trail duration (30 timeline seconds with trails off). Full-range mode retains events from the range start through the cursor. At most the latest 500 matching events are displayed.

All deployed assets use versioned filenames (for example `player-history-0.7.2.js`); helper imports use the same version. The Gradle bridge build runs the frontend build and packages those generated files. Replace the previous BlueMap integration JAR, restart/reload BlueMap and refresh the page. The recorder 0.6.1 public protocol remains compatible; no history deletion is required.

Event tooltips resolve item/dimension IDs and nested positions into readable lines rather than JSON. Newly visible markers scale/fade in; retained markers are reused and do not restart animations on each update. Reduced-motion preferences disable animation. Historical state uses the actual cursor time; absent old telemetry is reported as not recorded. A bundled inline Steve-style head replaces unavailable local skin images.

## Live mode and compact controls (0.7.2)

Live follows current events and chat with approximately one-second polling. Native BlueMap player heads provide the live position; historical heads are hidden in Live to avoid duplicate positions. Scrubbing or starting playback switches to history. Live returns to a rolling range if custom dates were selected.

Clicking an event or trail opens its tooltip without moving the timeline. Event markers retain their identity during playback, so open tooltips persist. Each event type has a distinct icon color, surrounded by the player's color. New markers animate in; reduced-motion preferences disable that animation.

Item pickup/drop, block place/break and container-open are hidden by default in new viewer preferences. The Events menu enables them individually; saved preferences take precedence. Chat is enabled by default and also appears as readable recent messages.

The collapse chevron leaves the histogram timeline, shuttle slider and compact play/pause control visible. Expand restores range, speed, player and event controls. Mobile spacing and widths are reduced to leave more of the map visible.
