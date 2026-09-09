# Player History 0.8.12

Two server-side **Minecraft 1.21.1 / NeoForge 21.1.248+ / Java 21** mods:

- **Player History Recorder** records movement, configurable state and activity, and publishes a versioned dataset. It does not depend on BlueMap.
- **Player History BlueMap** installs the replay viewer into **BlueMap 5.x**, links the public dataset, and maps BlueMap map IDs to Minecraft dimensions. It does not depend on recorder classes and can view an existing compatible dataset.

Install `player-history-recorder-0.8.12.jar` for recording. Add BlueMap and `player-history-bluemap-0.8.12.jar` for map visualization. Neither mod is required on clients. Remove the previous combined Player History JAR before upgrading; the recorder retains its `playerhistory` mod ID and `config/playerhistory-common.toml`.

The default dataset remains `<world>/player-history/`. Existing movement/event binary **v1** recordings remain readable. New typed state/inventory records use an independent binary **v1** stream. The browser protocol is **v2**.

The viewer defaults to a three-hour range, live mode and one-minute trails. It includes playback speed, a ±120× elastic shuttle, activity histogram, custom date/time range, persistent player selection, trails and heatmap. Ranges include **last hour, 3 hours, 6 hours, 24 hours, 48 hours, week, 30 days, last N days, all history and custom dates**. Historical players appear as local BlueMap skin heads, with names/details on hover or keyboard focus. Trails and event icons share each player's color. Trail hover places a dot at the selected segment position and interpolates that point's historical timestamp without crossing discontinuities.

## Build

```sh
./gradlew :recorder-neoforge:build
./gradlew :bluemap-neoforge:build
npm test
npm --prefix bluemap-addon run build
```

Both mod builds are independent. Use Java 21. JARs are in each module's `build/libs/`; distribution copies are in `outputs/`. Frontend assets are in `bluemap-addon/dist/` and can be rebuilt without rebuilding either mod.

## Documentation

- [Architecture](docs/architecture.md)
- [Configuration and complete example](docs/configuration.md)
- [Public protocol](docs/public-protocol.md)
- [Binary storage](docs/storage-format.md)
- [BlueMap installation and frontend watch workflow](docs/bluemap-addon.md)
- [Migration from the combined mod](docs/migration.md)
- [Verification and limits](docs/verification.md)

## Recording and privacy

Movement retains stationary suppression, fixed-point deltas, session boundaries, bounded asynchronous writes, CRC recovery and discontinuity-safe replay. State changes use checkpoints plus typed deltas. Full inventory history is **off by default**, and stores slot changes when enabled. Supported activity includes block break/place, container opening, damage, kills, advancements, crafting, smelting, enchanting, trading and item pickup/drop.

Recorder exclusions and Minecraft invisibility apply independently of BlueMap visibility. **BlueMap-hidden players are no longer automatically excluded**: use recorder UUID/dimension exclusions or Minecraft invisibility. Public chat is recorded by default (`tracking.chat`); no command arguments, packet history, arbitrary NBT or container contents are recorded.

Published movement, state, inventory and event data are readable by anyone who can access the public directory. Viewer filters are not access controls. Disabling a tracker stops future capture; it does not delete existing records. Retention runs asynchronously: `-1` keeps everything, `0` keeps the current UTC day, and positive N keeps N previous UTC days plus today. Protect the whole dataset with your web-server access policy if needed.

Playback and event filters were checked in the disposable NeoForge/BlueMap server and browser. See the verification document for scope and local test results.

Event icons follow the trail duration, or remain for 30 timeline seconds when trails are off. Full-range events accumulate from the range start to the cursor. The Events menu toggles individual categories in the viewer and remembers preferences in this browser. Playback at the range end restarts from the beginning.

Viewer fixes in 0.8.1: immutable filenames for all helper assets prevent mixed cached versions; initialization waits for the cache; player state uses the replay cursor time; missing skin heads use an embedded fallback. Event types have distinct icon colors with player-colored rings, readable details and an entrance animation. Overlay refresh preserves active tooltips and existing markers.

0.8.1 adds public chat recording, near-real-time event/chat display while preserving historical batches, and a collapsible mobile panel. Clicking trails/events opens details without seeking. Live uses BlueMap's native player heads without historical duplicates. Item pickup/drop, block place/break and container-open start hidden in fresh viewer preferences; enable them in Events.


## Version 0.8.12

The timeline keeps the full selected range, including empty periods and custom dates outside recorded data. NOW follows current time, and dragging fully right enters live mode. Live trails load before the History panel is opened. Range, speed, trail, player, heatmap and event choices persist in the browser. Timeline event marks remain visible independently of trail duration, with distinct chat marks. Chat history covers the selected range with timestamps and follows new messages until the user scrolls up. Nearby event bursts use dense count markers that open a timestamped, icon-labelled scrollable list only when clicked; timestamped chat bubbles remain directly readable. Join, leave and Minecraft death messages also appear in chat. Historical player markers show compact Minecraft hearts; live mode relies on BlueMap’s native player marker without a drifting duplicate overlay. Chat rows include player heads and navigate the timeline and camera to their recorded position. Chat and death ticks use distinct bubble and skull markers, event-group lists isolate hover interactions, and compact player tooltips round recorded values.

Recent movement is published in the live feed without waiting for the historical batch. Authenticated web chat uses a one-time in-game linking command instead of IP matching. Install **both** 0.8.12 mods for these features. See [Web chat setup and live trails](docs/web-chat.md) for the required same-origin HTTPS proxy route, commands, session expiry and limits.
