# Configuration

The recorder keeps `config/playerhistory-common.toml`. This is a complete default configuration (original top-level movement/privacy keys remain compatible):

```toml
enabled = true
sample-interval-ms = 500
minimum-movement-distance = 0.25
forced-keyframe-interval-seconds = 30
chunk-duration-minutes = 5
retention-days = 180
queue-capacity = 8192
heatmap-cell-size = 8
heatmap-enabled = true
respect-hidden-players = true
track-deaths = true
track-teleports = true
track-dimension-changes = true
excluded-players = []
excluded-worlds = []

[publishing]
enabled = true
public-directory = "player-history/public"

[tracking]
movement = true
sessions = true
health = true
food = true
saturation = false
xp = true
game-mode = true
effects = true
posture = true
held-item = true
equipment = true
curios = true
inventory = false
block-break = true
block-place = true
container-open = true
damage-taken = true
damage-dealt = true
mob-kills = true
player-kills = true
advancements = true
crafting = true
smelting = true
enchanting = true
trading = true
item-pickup = true
item-drop = true
item-damage = true
item-enchantments = true
item-custom-name = true

[state]
checkpoint-interval-minutes = 10
```

## Categories

| Switch | Captured information |
|---|---|
| movement | Threshold/keyframe optimized positions; closing boundaries remain necessary when disabling |
| sessions | JOIN, QUIT and RESPAWN annotations; movement discontinuities are independent |
| health | Health, maximum health, absorption |
| food / saturation | Food; optional saturation requires food enabled |
| xp | Total XP, level, progress; no inferred source attribution |
| game-mode | Current game mode |
| effects | Resource keys, amplifier and ambient changes; additions/removals emerge from map deltas; no countdown updates |
| posture | Sprint/sneak/swim/elytra/sleep/fire/frozen state |
| held-item | Selected slot and main-hand stack |
| equipment | Main/offhand, helmet, chestplate, leggings, boots; independent of inventory |
| curios | Visible Curios stacks, including cosmetic overrides, keyed by Curios slot identifier and index; no hard Curios dependency |
| inventory | Inventory checkpoint plus changed slot keys, including empty slots |
| block-break / block-place | Uncancelled block events, block ID and exact block coordinates |
| container-open | Menu type and player position; container block position/first loot generation are explicitly unavailable |
| damage-taken / damage-dealt | Applied damage, source, target type and post-damage health |
| mob-kills / player-kills | Uncancelled death attributed to a player; target type |
| advancements | Earned advancement ID |
| crafting / smelting | Crafted/smelted output stack |
| enchanting / trading | Enchanted stack / completed trade output stack |
| item-pickup / item-drop | Picked-up quantity / uncancelled tossed stack |
| item-damage / item-enchantments / item-custom-name | Optional stack metadata across enabled item categories |
| track-deaths / track-teleports / track-dimension-changes | Original event annotation switches, retained at top level |

Existing NeoForge config files keep their previously written values when defaults change. Builds before the 3D-pose work generated `tracking.posture = false`; if that value is still present, crouch, sprint, swim, elytra and sleep poses cannot be reconstructed. Set it to `true` (or remove the old entry and let NeoForge regenerate it). The viewer reports this condition from `manifest.json` instead of silently showing rigid avatars.

State is sampled at the configured sample interval, but only changes/checkpoints enter the queue. Each chunk starts with a checkpoint, even if the periodic interval is longer. Rejoins/respawns reset checkpoints. Inventory shares that interval and encodes only changed slots between checkpoints. The snapshot reports slot state, not a reason for an inventory change.

Items use integer registry IDs. Custom names are capped at 256 characters and enchantments at 32 entries. No full component/NBT, book text, shulker contents or block-entity data is captured. Typed records limit nesting to 8, collections to 256 entries, strings to 8192 characters and frames to 256 KiB. State chunks are bounded to 100,000 records; exceeding storage limits stops the writer with an error instead of growing memory without a bound. Sparse event payloads are limited to 2048 characters; oversized details become an explicit `detailsTruncated` marker.

Unsupported/deferred capture has **no fake switches**: generic block interaction, container transfers/contents, loot-first-open detection, anvil/brewing events, XP-source inference and full item components/NBT. Modded actions only appear if they emit the supported NeoForge events. The new hooks have compiled and passed local pure-data tests, but have not been exercised on a Minecraft server in this release.

## Reload and retention

Tracking/category switches, item metadata, checkpoint cadence, sample interval, exclusions, Minecraft invisibility and the retention value are read during recording after a config reload. Disabling state fields emits explicit unknown values; re-enabling captures their current values. Disabling movement closes the current segment and re-enabling resets the sampler. Changes do not erase old data. Retention changes apply on the next hourly worker maintenance pass.

Writer startup, publication destination/enabling, queue size, movement threshold/keyframe interval and heatmap enabling require a server restart. Starting with `enabled=false` requires restart to create the writer. `enabled=false` during an active run closes eligible history and prevents further capture. Chunk duration and heatmap cell size require a new dataset if changed; allowed chunk minutes divide 60 (1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60).

Retention `-1` means unlimited. `0` retains the current UTC calendar day. Positive N retains N previous UTC calendar days plus today. Cleanup covers movement/events, state/inventory, derived heatmaps and the remembered public chunks/state/heatmap/activity directory, including expired temporary and quarantined files. Registries remain stable and are not renumbered. Current-day files are retained. Cleanup needs the recorder's worker running; uninstalling it does not expire static exports or backups.

`/playerhistory stats` includes written movement count, state changes, event count, inventory field deltas, queue/dropped envelopes, movement bytes, writer latency, retention days, failure and stationary suppression. Byte counts currently cover movement/event framing, not all filesystem bytes; counters reset on restart.

`[tracking] chat = true` records uncancelled public chat. Set `chat = false` inside the existing tracking section to disable it. Commands and private messages are excluded. Public chat uses the same player exclusions as other telemetry. Viewer event filters do not disable recording.
