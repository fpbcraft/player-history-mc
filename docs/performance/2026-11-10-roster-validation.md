# Combined roster and map-transition validation

The combined Player History branch passed its complete Java build: 38 recorder, 13 integration and 6 MOTD tests, all successful. The viewer check passed typechecking, lint, production build and all 150 tests. BlueMap's companion branch passes seven Node tests and its NeoForge release build.

A real Chrome integration probe loaded the production BlueMap page with local candidate scripts and synthetic player snapshots intercepted only inside that browser. It did not modify production data or configuration. The fixture contains one online Overworld player, one online Nether player, and one offline Overworld player. Skins and the rest of the map were loaded through normal production URLs. This tests map API integration, not actual online-player freshness or server-side telemetry capture.

## Failures found and fixed

- Switching dimensions from a roster card initially dropped follow intent. BlueMap resets its controls after its map switch promise's terrain phase; binding a target before the complete app switch looked like a manual unfollow. A navigation token now preserves intent and defers target binding until the app finishes its camera/manager initialization. The asynchronous regression test deliberately resets the camera while a map switch is pending.
- The initial browser run produced four uncaught errors in map-area loading, terrain rendering and terrain-height sampling. The lazy BlueMap branch reported `isLoaded` when materials existed, before its tile managers did. Readiness now requires both managers. Map/viewer/app generation guards prevent superseded loads from installing resources, changing the current map, resetting its camera or initializing duplicate managers.
- Desktop roster cards overlapped the top map toolbar. On mobile, overlay/zoom controls covered part of the horizontally scrolling roster. The bar now starts below the top toolbar and reserves the mobile controls' column, including padding and borders in its width budget.

## Final browser result

The final probe passed with **zero page exceptions**:

- Three all-dimension cards with loaded global skin/hat images, dimension labels, correct known HP and observed posture.
- World-space avatars restricted to the active dimension.
- Unchanged card/image DOM retained across multiple live publications.
- Clicking the Nether player switches maps and retains an actual bound follow target.
- Clicking the offline player returns to its dimension and navigates to a fixed last location without following a nonexistent entity.
- The 390×844 roster stays inside the viewport and ends before the overlay controls.
- Offline markers/cards are absent during historical mode and return after closing it.

The failed and final JSON snapshots are retained beside the original investigation evidence as `player-roster-before.json` and `player-roster-after.json`. Screenshots and the complete local report are in `build/validation/player-roster/`. Reproduction instructions are in `tools/README.md`.

This is functional validation, not a comparative page-load or FPS benchmark. Physical-mobile testing, real actors/equipment, authenticated chat, long-session/reconnect tests, and comparative performance measurements remain pending. The production server was not deployed or restarted, and no PR was merged.
