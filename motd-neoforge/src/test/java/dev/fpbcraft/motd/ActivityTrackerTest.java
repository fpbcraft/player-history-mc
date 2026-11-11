package dev.fpbcraft.motd;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Path;
import java.time.Instant;
import java.time.ZoneId;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ActivityTrackerTest {
  @TempDir Path dir;
  private static final ZoneId UTC = ZoneId.of("UTC");

  @Test
  void countsDistinctVisitorsAndConcurrentPlaytimeAcrossRestarts() throws Exception {
    Path file = dir.resolve("activity.json");
    long now = Instant.parse("2026-11-02T12:00:00Z").toEpochMilli();
    var tracker = new ActivityTracker(file, now);
    tracker.join("a", "Alex", now, UTC);
    tracker.advance(now + 60_000, UTC);
    tracker.join("b", "Blair", now + 60_000, UTC);
    tracker.advance(now + 120_000, UTC);
    tracker.leave("a", now + 120_000, UTC);
    tracker.leave("b", now + 120_000, UTC);
    var stats = tracker.snapshot(now + 120_000, UTC, now);
    assertEquals(2, stats.playersToday());
    assertEquals(2, stats.playersWeek());
    assertEquals(180_000, stats.playMillisToday());
    assertEquals(2, stats.peakToday());
    assertEquals(0, stats.online());
    assertEquals("Blair", stats.lastPlayer());
    assertEquals(now + 120_000, stats.lastActiveAt());

    tracker.save(now + 120_000, UTC);
    var restored = new ActivityTracker(file, now + 130_000);
    restored.load();
    var saved = restored.snapshot(now + 130_000, UTC, now + 130_000);
    assertEquals(2, saved.playersToday());
    assertEquals(180_000, saved.playMillisToday());
    assertEquals("Blair", saved.lastPlayer());
  }

  @Test
  void splitsPlaytimeAcrossMidnightAndCountsOvernightVisitors() {
    long start = Instant.parse("2026-11-01T23:59:30Z").toEpochMilli();
    var tracker = new ActivityTracker(dir.resolve("activity.json"), start);
    tracker.join("a", "Alex", start, UTC);
    long end = start + 60_000;
    tracker.advance(end, UTC);
    var stats = tracker.snapshot(end, UTC, start);
    assertEquals(30_000, stats.playMillisToday());
    assertEquals(1, stats.playersToday());
    assertEquals(1, stats.playersWeek());
    assertEquals(1, stats.peakToday());
  }

  @Test
  void handlesDaylightSavingMidnightInConfiguredTimezone() {
    ZoneId zone = ZoneId.of("America/Toronto");
    long start = Instant.parse("2026-11-01T03:59:30Z").toEpochMilli();
    var tracker = new ActivityTracker(dir.resolve("activity.json"), start);
    tracker.join("a", "Alex", start, zone);
    var stats = tracker.snapshot(start + 60_000, zone, start);
    assertEquals(30_000, stats.playMillisToday());
    assertEquals(1, stats.playersToday());
  }

  @Test
  void retainsLastActivityWhenServerStopsWithPlayersConnected() throws Exception {
    long now = Instant.parse("2026-11-02T12:00:00Z").toEpochMilli();
    var tracker = new ActivityTracker(dir.resolve("activity.json"), now);
    tracker.join("a", "Alex", now, UTC);
    tracker.stop(now + 10_000, UTC);
    tracker.save(now + 10_000, UTC);
    assertEquals(now + 10_000, tracker.snapshot(now + 15_000, UTC, now).lastActiveAt());
    assertTrue(java.nio.file.Files.exists(dir.resolve("activity.json")));
  }
}
