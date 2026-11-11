# FPBCraft Dynamic MOTD

`fpbcraft-motd-<version>.jar` is a **server-only** mod for Minecraft 1.21.1,
NeoForge 21.1.248+ and Java 21. No client installation, BlueMap or Player History
Recorder dependency is required.

## Installation

1. Download the `fpbcraft-motd-<version>.jar` asset from this repository's release.
2. Put it in the dedicated server's `mods/` directory and restart the server.
3. Edit `config/fpbmotd-common.toml` (generated at first startup).
4. The new description appears the next time the multiplayer client refreshes its server list.

The mod only changes the advertised MOTD; it does not change the server icon,
protocol, max player slots, gameplay or login flow. Remove any other MOTD rotating
mod if it also changes the vanilla server status.

## Configuration

Default values are equivalent to:

```toml
enabled = true
rotation-seconds = 45
timezone = "America/Toronto"
header = "§aFPBCRAFT §7• §fSurvival & Create"
pack-version = ""
messages = [
  "§e{players_today} §7players today • §b{playtime_today} §7played",
  "[empty] §7Last player online §e{last_online} §7ago",
  "[online] §a{online} §7players exploring right now!",
  "§7Today's peak: §e{peak_today} §7online",
  "§7Server uptime: §a{uptime}",
  "§7World day: §e{world_day}"
]
```

The first line remains fixed, and the second line rotates every 45 seconds.
`[online]` messages are eligible only while someone is connected, and
`[empty]` only when the server is empty. Other lines are always eligible.
If none qualifies, a simple welcome line is shown. The rotation does not run
on the networking/ping thread.

Supported placeholders:

| Placeholder | Meaning |
| --- | --- |
| `{online}` | Current connected players |
| `{players_today}` | Distinct UUIDs online during the local calendar day |
| `{players_week}` | Distinct UUIDs across today and six preceding calendar days |
| `{playtime_today}` | Sum of all players' session durations today (d/h/m/s) |
| `{peak_today}` | Highest concurrent player count today |
| `{last_online}` | Time elapsed since any player was last online; `never` without data, `now` if occupied |
| `{last_player}` | Most recently disconnected player name, or `none` |
| `{uptime}` | Time since the current server boot |
| `{world_day}` | Current Overworld day based on game time |
| `{pack_version}` | Admin-controlled config label |

Use Minecraft's `§` color codes in the header and messages.

## Persistence and limitations

Small daily counters are saved under `<world>/fpb-motd/activity.json` every
minute and at normal server shutdown, with a temporary file and atomic
replacement where supported. At most eight calendar days of counters are kept.
The mod accounts for midnight in the configured IANA timezone (including
daylight-saving changes). A crash can lose up to one minute of playtime and
might leave the last-activity timestamp at the most recent checkpoint.

Statistics start collecting when the mod is installed; historical Player
History recordings are not imported. If the activity JSON cannot be loaded,
the mod leaves the file untouched and disables its own MOTD for that server
session rather than overwriting the damaged data.

The server-list client decides when to refresh its status; a displayed MOTD
can lag behind the current server selection until the client polls again.
Changing the TOML file while the server runs will be picked up on subsequent
status updates if NeoForge reloads that configuration file.
