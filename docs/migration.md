# Upgrade from the combined mod

1. Stop the server and back up `<world>/player-history/` and existing public exports.
2. Remove the previous combined `bluemap-player-history-*.jar` (or older combined Player History JAR). Do not install it alongside the recorder: both use mod ID `playerhistory`.
3. Install `player-history-recorder-0.6.0.jar`. Keep `config/playerhistory-common.toml` and the existing history directory. New config keys receive defaults. Movement/events retain their exact v1 codec; state uses a new separate stream, so there is no binary reinterpretation or required conversion.
4. If using BlueMap, install `player-history-bluemap-0.6.0.jar` and set its public directory to match recorder publishing. The new default is `<world>/player-history/public`.
5. On startup, the recorder asynchronously republishes existing movement/events, state and derived data into the configured public directory. The bridge links BlueMap's `player-history/data` there. Backfill can take time; missing files are shown as missing history until available.
6. If an old public `data` directory/link occupies the bridge destination, it is preserved as `legacy-data-<timestamp>` instead of deleted. After checking your backup and new export, remove that old copy explicitly. **Those backups remain publicly accessible if left under the webroot and are not managed by new retention.** Publication paths copied elsewhere are also your responsibility.
7. Remove old manual script/style registrations from BlueMap configuration. BlueMap resets API registrations on enable; the bridge registers only its current versioned assets. Refresh browser caches. Do not load the old embedded viewer alongside the new one.

Privacy changes deliberately with the split: the recorder no longer asks BlueMap whether a player is hidden. Recorder UUID/dimension exclusions and Minecraft invisibility remain supported. Configure these before enabling the new recorder if BlueMap visibility was previously your recording gate. Existing records are never erased merely by changing an exclusion or disabling a tracker.

Keep chunk duration and heatmap cell size unchanged for existing data. Changing either requires a new/archived dataset. The latest public output and its predecessor are different directories; reducing retention cannot revoke independent backups, downloads or third-party caches.
