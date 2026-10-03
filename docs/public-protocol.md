# Public protocol v2

Consumers must reject unknown `protocolVersion` values. Internal `formatVersion: 1` describes movement binary storage, not the public protocol. Recorder and viewer release numbers need not match.

`manifest.json` has:

| Field | Meaning |
|---|---|
| `protocolVersion` | `2` |
| `formatVersion` | Movement storage version `1` |
| `generatedAt` | Publication time, epoch milliseconds |
| `earliestTimestamp`, `latestTimestamp` | Available history bounds, epoch milliseconds |
| `chunkDurationMs` | UTC-aligned chunk duration |
| `registry.players` | `{id, uuid, name}`; stable positive IDs |
| `registry.worlds` | `{id, key}`; zero-based Minecraft dimension IDs |
| `registry.items` | `{id, key}`; positive item IDs, zero means empty |
| `capabilities` | Tracker keys enabled at least once for this dataset; may include categories without samples |
| `trackingEnabled` | Current tracker configuration |
| `cellSize` | Heatmap cell size in blocks |
| `activityBucketMs` | `60000` |
| `activityReady` | Player activity backfill finished |

Capability history is persisted so disabling a tracker does not hide previous data. Capability booleans do not establish that a value exists at a particular time: only checkpoints/deltas do. A category can remain advertised after its old data expires. The viewer uses capability flags for state fields and unavailable overlay controls. Older data migrated from the combined release has no state records.

For T, `bucket = floor(T / chunkDurationMs) * chunkDurationMs`:

- `chunks/<bucket>.json`: `{points: [...], events: [...]}`. Points are `{player,time,world,x,y,z,flags}` with **32 coordinate units per block**. Events are `{point,type,payload}`, with a bounded JSON string payload. Unknown event types can be displayed using a generic icon.
- `states/<bucket>.json`: ordered `{player,time,kind,values}` records. `kind` is `checkpoint`, `delta` or `unknown`. Checkpoints replace all state; deltas replace only named fields; a null field means unknown/disabled. `unknown` clears state until a new checkpoint. Each bucket begins a player's state with a checkpoint. Never extrapolate across a missing bucket or apply a delta without a checkpoint.
- `activity/<UTC-day>.json`: `[minuteTimestamp,count]` rows. Counts derive only from retained online player movement observations, excluding copied movement context and offline markers. Events and object history do not contribute; this measures recorded player activity density, not distance or unique players. Missing minutes are zero.
- `heatmap/{chunk,hour,day}/<bucket>.json`: `[player,world,cellX,cellZ,durationMs]` rows. Negative coordinates use floor division.

State fields include health/maxHealth/absorption, food/saturation, xpTotal/xpLevel/xpProgress, gameMode, effects, selectedSlot/heldItem, `equipment:<slot>`, optional visible Curios as `curio:<identifier>:<index>`, optional posture flags and `slot:<inventory index>`. Posture state includes sprinting, sneaking, swimming, elytra flight, sleeping, on-ground, fire and frozen state; new configurations enable posture tracking by default. An item is `{item,count,damage?,name?,enchantments?,color?}`; `color` is the RGB value of Minecraft's dyed-item component when present. Empty stacks are `{item:0,count:0}`. Effects are keyed by resource location with amplifier and ambient values; no duration countdown is sampled. Equipment slots use Minecraft names (`mainhand`, `offhand`, `head`, `chest`, `legs`, `feet`). Inventory indices follow `PlayerInventory` (including armor and offhand).

The bounded frontend state cache holds four chunks and refreshes mutable data. Missing/unreadable state returns unknown. A trail hover uses its own interpolated time, not the global replay cursor.

BlueMap's `player-history/integration.json` is separate, addon-owned configuration: `{"mapWorlds":{"map-id":"minecraft:overworld"}}`. It is not part of the recorder protocol. Skin images use the local map data root's `assets/playerheads/<uuid>.png`, falling back to BlueMap's Steve image.

## Live events

`live.json` is a replaceable, non-authoritative snapshot with `protocolVersion: 2`, `generatedAt`, `registry`, recent `points` and `events` using the historical shapes, plus optional `states` keyed by player ID. Each state value is the recorder's reconstructed current state after applying checkpoints and deltas; an ended or unknown player is omitted. The recorder worker publishes at most every 250 ms, retaining at most 1,000 events from the last five minutes. The viewer polls once per second and ignores snapshots older than ten seconds. Historical chunk batching remains unchanged. This provides near-real-time public chat and event display, not guaranteed delivery; historical chunks remain authoritative. The file is overwritten on restart and is not an archive.

`CHAT` payloads contain `message`: public chat text capped at 512 characters and subject to the existing event payload limit. Commands and private messages are not captured. Recorder visibility/exclusion rules apply.
