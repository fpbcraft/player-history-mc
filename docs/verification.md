# 0.7.2 playback, mobile transport and event visibility verification

26 frontend tests and 16 Java tests pass. The disposable project server loaded Player History Recorder 0.6.1 and Player History BlueMap 0.6.1 on NeoForge 21.1.248 with BlueMap 5.7. The bridge installed assets and linked the republished existing dataset successfully.

In the running BlueMap browser, pressing Play at the latest timestamp reset to the range start; the slider advanced from 149 ms to 5167 ms and the button remained Pause. Moving before recorded activity removed event icons. Disabling Teleport reduced matching map icons from six to four. The trail duration changed from Off to one minute. No browser errors were reported during these checks. The server was stopped after verification.

Unit regressions cover the 30-second timeline lifetime (including expiry), finite/full-range trails, future-event exclusion and event type filters. This is a playback/viewer regression check against existing recordings, not a new full telemetry-hook or load test. Final packaging also includes persisted filter preferences, accessible labels and removal of the previous 0.6.0 script/style registration on upgrade.

# 0.6.0 verification

This release is verified using local Gradle compilation/JUnit tests and Node frontend tests only. **No Minecraft server was started or tested**, following the user instruction. The previous runtime evidence below does not validate the new two-mod bridge or telemetry hooks.

Results: **16 Java tests and 24 Node tests passed**; both JARs built successfully. Packaging inspection confirms no BlueMap classes/reflection strings or frontend assets in the recorder, and no recorder core classes in the BlueMap bridge. The standalone frontend build passed.

Checks cover movement/discontinuity regressions, typed state CRC and truncation, explicit unknown fields, checkpoint/delta and inventory reconstruction, state-only publishing/restart metadata, UTC retention across private/public categories, bounded frontend caches, exact trail hover timestamps, mocked BlueMap skin-head/event/focus/dot behavior and independent mod packaging. The mocked marker test does not substitute for live BlueMap/WebGL rendering.

Remaining runtime verification: NeoForge event-hook behavior with actual/modded inventories, independent mod loading, BlueMap symlink serving and skin-head rendering, dense-trail pointer performance and live migration/backfill. These were deliberately not exercised on a server in this release.

## Earlier release evidence (historical)

# Verification

## Version 0.5.0 local checks

Per request, no server or browser runtime verification was performed for 0.5.0. The offline Gradle build and 11 Java unit tests passed, including replacement-safe activity counts and exclusion of context points. All 19 frontend unit tests passed, including ±120× endpoints, histogram gaps, relative density, partial-minute clipping and single-timestamp ranges. The following runtime evidence is from version 0.4.0 and does not validate the new histogram in a running server.

Version 0.4.0 verified on 2026-09-07 with Java 21.0.12.1, Minecraft 1.21.1, NeoForge 21.1.248, and BlueMap 5.7 for NeoForge. All runtime work used the project's disposable `run/` directory and localhost browser connections. No PrismLauncher instance or live server was modified.

## Automated checks

`JAVA_HOME=/Library/Java/JavaVirtualMachines/openjdk-21.jdk/Contents/Home ./gradlew test build --console=plain` passed. The Java suite covers:

- fixed-point binary round trips with negative coordinates, negative Y, large positions/timestamps, world IDs, flags, events, and CRC-framed partial tails;
- stop and departure anchors, stationary suppression, and forced continuity semantics;
- time-spent heatmaps at two sampling rates, stationary time, discontinuity breaks, cross-chunk splitting, and retained player IDs;
- exact raw chunk selection and query limits;
- retention of current data and deletion of expired data;
- BlueMap-absent visibility, installed-provider failure, Minecraft invisibility, and exclusions;
- queue-overflow gaps with offline and restart boundaries;
- temporary-chunk recovery, session closure, same-bucket restart append, and corrupt-chunk isolation.

`npm test` passed 18 Node tests. They cover interpolation, session visibility, teleport and dimension boundaries, mid-history context, stop anchors, missing-current-chunk gaps, bounded three-chunk caching, daily heatmap selection, trail clipping, 48-hour and single-sample ranges, latest-follow versus historical refresh, shuttle rate mapping, reverse boundary clamping, release restoring play/pause, cached-miss invalidation, and aborted in-flight cache writes.

JavaScript syntax was checked with Node. `git diff --check` passed before packaging.

## Server runtime

The NeoForge development server started successfully without BlueMap and with BlueMap 5.7. The full scenario was initially exercised on NeoForge 21.1.249, then the final source and dependency metadata were rebuilt and the server was started successfully against exact NeoForge 21.1.248. The standalone run logged that recording remained enabled without BlueMap. A temporary protocol test player joined, moved, stopped, teleported, changed dimension, died, respawned, ran `/playerhistory stats`, and disconnected.

The resulting published chunk contained 43 points and ten event records across `JOIN`, `QUIT`, `TELEPORT`, `DIMENSION_CHANGE`, `DEATH`, and `RESPAWN`. The runtime stats reported accepted points, 13 stationary skips, zero dropped envelopes, written bytes, the current chunk, zero writer failure, and negligible observed writer lag. A graceful stop finalized the temporary chunk and aggregates.

BlueMap 5.7 loaded the mod through NeoForge, registered `player-history.js` and `player-history.css` through `WebApp`, copied its isolated modules, mapped all three vanilla dimensions, served its web application on localhost, and published manifest/chunk/heatmap data.

## Browser runtime

The actual BlueMap 5.7 web application was opened in an isolated automated Chromium session. The new bottom transport was checked at desktop 1280×800 and mobile 390×844, with an additional 320-pixel viewport inspection. It has compact range/speed selectors and date-time pickers only in Custom dates, with no event checkboxes or sidebar.

The repeatable CDP script `tests/browser-verification.mjs` exercises the existing recorded scenario and page-local manifest fixtures. Run it with Node 22+ against the local Chromium debugging HTTP endpoint after opening the disposable BlueMap page. It passes 42 checks, including:

- opening at latest with the real shorter-than-48-hour range;
- all ten recorded events enabled, with eight markers in the current map dimension;
- timeline seeking and tooltip updates before mouse release;
- shuttle fast-forward while paused, rewind while dragging outside the control, and release restoring paused/playing states;
- player filtering, Select all, and outside-click popover dismissal;
- full trails and same-range heatmap loading through compact buttons;
- rolling 48-hour clamping, following latest, preserving a historical absolute timestamp, and selecting newly discovered players using page-local manifest fixtures;
- day/week/month/all range presets, custom days and invalid-value rejection;
- selected 8× playback speed and restoration after shuttle release;
- fixed custom dates, refresh stability, and reversed-date rejection;
- eight trail choices and two-player renderer fixtures with distinct colors;
- actual pointer hover over rendered trail geometry and an event marker, with detail tooltips;
- mobile bounds and separation from BlueMap's zoom controls;
- real CDP touch timeline/shuttle events and immediate reset on touch cancellation;
- overlay disposal on collapse and latest positioning on reopening;
- no uncaught browser exceptions.

Screenshots are packaged as `outputs/history-redesign-desktop.png` and `outputs/history-redesign-mobile.png`. The 48-hour refresh scenarios use synthetic manifest timestamps in the browser; the actual recorded movement scenario spans a few minutes. Server data is unchanged by the browser fixtures.

## Boundaries

This verifies local correctness and integration behavior for one automated player on BlueMap 5.7. It is not a production soak test, load benchmark, authentication audit, or validation against every vanish mod and custom teleport implementation. The heatmap is a flat batched overlay; terrain-conforming 3D rendering remains future work. Real-world retention and storage estimates should be measured from the target server's movement patterns.

Custom date picker screenshots: `outputs/history-custom-dates-desktop.png` and `outputs/history-custom-dates-mobile.png`. Multi-player color and hover checks use browser-local renderer fixtures, not additional recorded players.

## 0.7.2 verification (2026-09-08)

Both NeoForge modules built successfully offline on Java 21 / NeoForge 21.1.248. All 30 frontend tests passed, including the browser-fetch receiver regression, immutable imports, event visibility and retained marker/no-seek behavior. The Gradle Java test suite passed.

On the disposable local server, a public chat event reached `live.json` 54 ms after sending while absent from the historical chunk; it appeared in the regular chunk after the normal flush. In the BlueMap 5.7 browser, live chat and its readable map tooltip were present with one native live player head. Playback advanced and collapsed mode exposed only two sliders, play/pause and expand, without the reported JavaScript exceptions. Mobile expanded and collapsed layouts were visually checked at 390 × 844; collapsed transport occupied approximately 96 pixels in height. Production deployment and physical-phone testing were not performed.

## 0.7.3 mobile layout correction

Removed conflicting mobile/compact CSS blocks. Both mobile states retain an in-flow timestamp and fixed header columns for expand/collapse and close. The histogram fits inside a 60px timeline with 32px bars. Desktop remains expanded. All 30 frontend tests and the offline Gradle build passed. Browser verification was blocked by the locked Mac; this revision has not been visually validated on a phone.
