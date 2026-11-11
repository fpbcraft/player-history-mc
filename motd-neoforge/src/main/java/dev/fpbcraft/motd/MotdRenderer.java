package dev.fpbcraft.motd;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** Pure formatting of already-collected activity data. */
final class MotdRenderer {
  private MotdRenderer() {}

  static String render(String header, List<? extends String> entries, int index,
                       ActivityTracker.Snapshot stats, long now, long worldDay, String packVersion) {
    List<String> eligible = new ArrayList<>();
    for (String entry : entries) {
      if (entry == null || entry.isBlank()) continue;
      if (entry.startsWith("[empty]")) {
        if (stats.online() == 0) eligible.add(entry.substring(7).stripLeading());
      } else if (entry.startsWith("[online]")) {
        if (stats.online() > 0) eligible.add(entry.substring(8).stripLeading());
      } else eligible.add(entry);
    }
    String line = eligible.isEmpty() ? "§7Welcome to the server" :
        eligible.get(Math.floorMod(index, eligible.size()));

    String since = stats.online() > 0 ? "now" :
        stats.lastActiveAt() <= 0 ? "never" : duration(Math.max(0L, now - stats.lastActiveAt()));
    Map<String, String> values = Map.of(
        "{online}", Integer.toString(stats.online()),
        "{players_today}", Integer.toString(stats.playersToday()),
        "{players_week}", Integer.toString(stats.playersWeek()),
        "{playtime_today}", duration(stats.playMillisToday()),
        "{peak_today}", Integer.toString(stats.peakToday()),
        "{last_online}", since,
        "{last_player}", stats.lastPlayer().isBlank() ? "none" : stats.lastPlayer(),
        "{uptime}", duration(stats.uptimeMillis()),
        "{world_day}", Long.toString(worldDay),
        "{pack_version}", packVersion == null ? "" : packVersion);
    for (var replacement : values.entrySet()) line = line.replace(replacement.getKey(), replacement.getValue());
    String top = header == null ? "" : header.replace('\n', ' ').replace('\r', ' ');
    return limit(top, 180) + "\n" + limit(line.replace('\n', ' ').replace('\r', ' '), 180);
  }

  static String duration(long millis) {
    long seconds = Math.max(0, millis) / 1000;
    long days = seconds / 86400;
    long hours = (seconds % 86400) / 3600;
    long minutes = (seconds % 3600) / 60;
    if (days > 0) return days + "d " + hours + "h";
    if (hours > 0) return hours + "h " + minutes + "m";
    if (minutes > 0) return minutes + "m";
    return seconds + "s";
  }

  private static String limit(String text, int max) {
    return text.length() <= max ? text : text.substring(0, max);
  }
}
