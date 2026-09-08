# History storage format v1

All binary fixed-width values use Java DataOutput big-endian byte order. Filenames are UTC epoch millisecond bucket starts (`floorDiv(timestamp, duration) * duration`). A single chunk contains every player's points and events for that interval. IDs refer to `registry.json`; UUIDs are never inferred from names. Back up the registry with the tracks.

## Header (24 bytes)

| Field | Width | Value |
|---|---:|---|
| Magic | 4 bytes | `0x50485231` (`PHR1`) |
| Version | 4 bytes | signed int, currently 1 |
| Chunk start | 8 bytes | epoch milliseconds |
| Duration | 8 bytes | milliseconds |

There is no mutable record count in the header: independently checksummed frames contain their own counts. This avoids an in-place header update and permits prefix recovery. The end is start + duration; context records can precede the start. Chunk sizes configured by this implementation divide one UTC hour.

## Repeated frames

`int32 payloadLength`, payload bytes, `uint32 CRC32(payload)`.

Payloads have a 4 MiB limit. A frame is complete only when its trailing checksum is present and valid. Each frame resets its coordinate/time predictors and therefore decodes independently of earlier frames. A reader stops at an incomplete, corrupt, or malformed frame and exposes `partial=true` plus the byte offset after the last valid frame. Unknown headers are rejected. Header corruption is quarantined on recovery; corrupt files are isolated by the query layer.

### Point section

The first unsigned varint is the number of points (maximum 100,000/frame). For each point:

| Field | Encoding |
|---|---|
| player ID | unsigned varint |
| timestamp minus previous timestamp for this player in this frame | ZigZag varint |
| world ID | unsigned varint |
| X minus previous X | ZigZag varint |
| Y minus previous Y | ZigZag varint |
| Z minus previous Z | ZigZag varint |
| flags | unsigned byte |

For a player's first point in a frame, the previous timestamp is the chunk start and previous XYZ are all zero. Signed time deltas permit chunk-context points preceding the bucket. World IDs are always explicit to simplify independent decoding. Coordinates are signed integers at **32 units/block**, rounded to nearest unit (at most 1/64 block quantization error). Intermediate coordinate deltas use 64-bit arithmetic.

Varints use seven low payload bits per byte, low group first, bit 7 indicates continuation, maximum ten bytes for a 64-bit value. ZigZag maps signed `n` to `(n << 1) ^ (n >> 63)`. Overflowing encodings, invalid lengths, trailing payload bytes, and excessive counts are rejected.

### Flags

| Bit | Name | Semantics |
|---:|---|---|
| 1 | BREAK | Never interpolate **into** this point from its predecessor |
| 2 | OFFLINE | Player is invisible at and after this point until a new online point |
| 4 | HOLD | Stationary observation/departure anchor, for inspection and future codecs |
| 8 | CONTEXT | Copy of a previous actual sample to make the chunk independently seekable |

A connected segment requires an online predecessor, the same world, and no BREAK on the destination. OFFLINE may end a connected segment (quit/death time counts up to the endpoint). BREAK+OFFLINE ends a recording gap at the last known safe sample. At equal timestamps, stored order matters: endpoint closure precedes the new session/destination. Context copies do not override original records at the same player/timestamp.

HOLD does not freeze the segment that follows it. Stop and departure anchors already express the constant-position interval geometrically. Freezing every segment after HOLD would incorrectly delay movement.

### Event section

After all points: unsigned varint event count (maximum 100,000/frame), then each event:

- player ID varint
- timestamp minus chunk start, ZigZag varint
- world ID varint
- absolute fixed-point X, Y, Z as ZigZag varints
- flags byte
- type via Java `DataOutput.writeUTF` (modified UTF-8, unsigned 16-bit byte length)
- payload via the same UTF encoding

Types are strings of at most 64 Java characters; payloads are at most 2,048 characters. Built-in payloads contain JSON endpoint metadata. New event names do not require a format change. Inventory uses the independent state stream described below.

## Finalization, sessions, and gaps

The worker appends batches to `.tmp`, forces the channel at flushes, and atomically renames to `.bin` on rollover/close (replace-move fallback on filesystems without atomic moves). Registry JSON is replaced before writing batches that reference new IDs. Finalization into an existing same-time bucket first preserves its prior frames, allowing server restarts within a bucket.

On startup, valid `.tmp` prefixes are retained and unfinished sessions receive BREAK+OFFLINE at their last durable timestamp. Recovery never assumes the player stayed online until restart. The bounded-queue overflow policy preserves earlier accepted envelopes, closes known players at their last persisted point when intake resumes, and applies BREAK to each player's next accepted point. Shutdown closes eligible players and drains the queue for up to 30 seconds. A stuck writer logs that it exceeded this wait rather than hanging indefinitely.

## Derived and public representations

JSON transport chunks use `{points:[...], events:[...]}` and fixed-point integer coordinates. They are not the binary format and can be replaced by an authenticated query adapter in a future release. The public manifest contains `formatVersion`, `earliestTimestamp`, `latestTimestamp`, `chunkDurationMs`, `cellSize`, registry lists, public protocol version 2 and capability/configuration flags. BlueMap mapping lives only in the addon.

Heatmap files contain arrays `[playerId, worldId, cellX, cellZ, durationMillis]`. Duration is a floating-point millisecond amount from exact parametric spatial and temporal splitting. Negative cells use floor division. Fine aggregates remain the inputs for hourly and daily sums. Identity is retained at all levels; player filtering does not require raw tracks.

Retention removes whole UTC-day buckets from private tracks, derived files, and the remembered public destination, including stale temporary data. It runs asynchronously every hour. The current UTC day is retained for retention-days=0. Downloads or third-party caches cannot be revoked by deleting server files.

## Compatibility policy

Readers reject unsupported versions instead of guessing. Changes to coordinate scale, layout or flag interpretation require a version increment and explicit migration. Generic event additions do not. Changing chunk duration or aggregate resolution in an existing dataset requires a new dataset/rebuild; automatic migration is not implemented. JSON transport uses protocol version 2 independently of movement storage version 1. Keep raw records as the source of truth; use the offline rebuild task if derived data is missing or stale after a crash.


## Typed state stream v1 (0.6.0)

`states/<bucket>.bin` starts with big-endian int32 magic `0x50485331` (`PHS1`) and int32 version `1`. Frames use int32 payload length, payload, CRC32 as in movement, capped at 262144 bytes. The payload is int32 player ID, int64 epoch time, modified-UTF kind (`checkpoint`, `delta`, `unknown`), then a typed map. Tags: 0 null, 1 boolean, 2 float64 number, 3 modified-UTF string, 4 map (int32 count, UTF keys, recursively typed values), 5 list (int32 count and typed values). Nesting is bounded to 8, map/list count to 256, and each chunk to 100000 records. Item IDs/counts use the numeric tag; item names resolve through the stable item registry.

Checkpoints replace state; deltas replace named keys; null means an unavailable/disabled field. `slot:N` keys provide inventory snapshots/deltas without a second redundant stream. An `unknown` record ends a known interval, and later deltas alone cannot restart it. Every chunk boundary and periodic interval produces a fresh checkpoint. No new movement format version is implied by this separate stream.

The worker buffers pending state frames until registry publication, then flushes/forces them. Interrupted temporary files are truncated to a valid CRC prefix and closed with `unknown` for unfinished players at their last durable state timestamp. Unsupported headers are quarantined. A corrupt finalized state chunk is rejected rather than appended through corruption. Public state exports can be regenerated; callers must treat unreadable/missing chunks as unknown.

`capabilities.json` remembers enabled categories, and `publication.json` remembers the public directory for retention. Neither renumbers IDs. Published null values are preserved explicitly so a disabled field cannot silently retain an older value.
