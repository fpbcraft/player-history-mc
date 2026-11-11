package dev.fpbcraft.motd;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/** Server-thread-only activity counters; no history-file scan or work on a ping thread. */
final class ActivityTracker {
  private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
  private static final int RETAIN_DAYS = 8;
  private final Path file;
  private State state = new State();
  private final Map<String, String> online = new HashMap<>();
  private long accountedThrough;

  ActivityTracker(Path file, long now) {
    this.file = file;
    this.accountedThrough = now;
  }

  void load() throws IOException {
    if (!Files.exists(file)) return;
    try {
      State loaded = GSON.fromJson(Files.readString(file, StandardCharsets.UTF_8), State.class);
      if (loaded == null || loaded.days == null) throw new IOException("Missing daily counters");
      for (Day day : loaded.days.values()) {
        if (day == null || day.visitors == null) throw new IOException("Invalid daily counters");
      }
      state = loaded;
    } catch (RuntimeException failure) {
      throw new IOException("Invalid MOTD activity state at " + file + "; existing file preserved", failure);
    }
  }

  void join(String uuid, String name, long now, ZoneId zone) {
    advance(now, zone);
    online.put(uuid, name);
    Day today = day(Instant.ofEpochMilli(now).atZone(zone).toLocalDate());
    today.visitors.add(uuid);
    today.peak = Math.max(today.peak, online.size());
    state.lastActiveAt = now;
  }

  void leave(String uuid, long now, ZoneId zone) {
    advance(now, zone);
    String name = online.remove(uuid);
    if (name == null) return;
    state.lastPlayer = name;
    state.lastActiveAt = now;
    if (online.isEmpty()) state.lastEmptyAt = now;
  }

  void advance(long now, ZoneId zone) {
    if (now <= accountedThrough) return;
    if (!online.isEmpty()) {
      long cursor = accountedThrough;
      while (cursor < now) {
        LocalDate date = Instant.ofEpochMilli(cursor).atZone(zone).toLocalDate();
        long midnight = date.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli();
        long end = Math.min(now, midnight);
        Day record = day(date);
        record.visitors.addAll(online.keySet());
        record.peak = Math.max(record.peak, online.size());
        record.playMillis += (end - cursor) * online.size();
        cursor = end;
      }
      state.lastActiveAt = now;
    }
    accountedThrough = now;
  }

  Snapshot snapshot(long now, ZoneId zone, long startedAt) {
    advance(now, zone);
    LocalDate today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate();
    Day current = state.days.get(today.toString());
    Set<String> weekly = new HashSet<>();
    for (int i = 0; i < 7; i++) {
      Day day = state.days.get(today.minusDays(i).toString());
      if (day != null) weekly.addAll(day.visitors);
    }
    return new Snapshot(
        online.size(),
        current == null ? 0 : current.visitors.size(),
        weekly.size(),
        current == null ? 0 : current.playMillis,
        current == null ? 0 : current.peak,
        online.isEmpty() ? state.lastActiveAt : 0L,
        state.lastPlayer == null ? "" : state.lastPlayer,
        Math.max(0L, now - startedAt));
  }

  void stop(long now, ZoneId zone) {
    advance(now, zone);
    if (!online.isEmpty()) {
      state.lastEmptyAt = now;
      state.lastActiveAt = now;
      online.clear();
    }
  }

  void save(long now, ZoneId zone) throws IOException {
    advance(now, zone);
    LocalDate oldest = Instant.ofEpochMilli(now).atZone(zone).toLocalDate().minusDays(RETAIN_DAYS - 1);
    state.days.keySet().removeIf(key -> {
      try { return LocalDate.parse(key).isBefore(oldest); }
      catch (RuntimeException invalidDate) { return true; }
    });
    Files.createDirectories(file.getParent());
    Path temporary = file.resolveSibling(file.getFileName() + ".tmp");
    Files.writeString(temporary, GSON.toJson(state), StandardCharsets.UTF_8);
    try {
      Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    } catch (AtomicMoveNotSupportedException unsupported) {
      Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING);
    }
  }

  private Day day(LocalDate date) {
    return state.days.computeIfAbsent(date.toString(), ignored -> new Day());
  }

  record Snapshot(int online, int playersToday, int playersWeek, long playMillisToday,
                  int peakToday, long lastActiveAt, String lastPlayer, long uptimeMillis) {}

  private static final class State {
    Map<String, Day> days = new LinkedHashMap<>();
    long lastActiveAt;
    long lastEmptyAt;
    String lastPlayer = "";
  }

  private static final class Day {
    Set<String> visitors = new HashSet<>();
    long playMillis;
    int peak;
  }
}
