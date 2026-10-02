package dev.playerhistory.core;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

/** Shared retention helpers for timestamp-prefixed history files. */
public final class RetentionFiles {
  private static final long DAY_MS = 86_400_000L;

  private RetentionFiles() {}

  public static long cutoffUtcDay(long now, int retentionDays) {
    if (retentionDays < 0) throw new IllegalArgumentException("Invalid retention");
    return Math.floorDiv(now - retentionDays * DAY_MS, DAY_MS) * DAY_MS;
  }

  /**
   * Prunes the recorder's recursive history trees.
   *
   * <p>Only durable/history suffixes are eligible, matching the legacy HistoryStore behavior.
   */
  public static void pruneHistoryTree(Path dir, long cutoff) throws IOException {
    if (!Files.exists(dir)) return;
    try (var paths = Files.walk(dir)) {
      for (Path path : paths.filter(Files::isRegularFile).toList()) {
        String name = path.getFileName().toString();
        if (!(name.endsWith(".bin")
            || name.endsWith(".json")
            || name.endsWith(".tmp")
            || name.endsWith(".corrupt"))) continue;
        Long timestamp = timestampPrefix(name);
        if (timestamp != null && timestamp < cutoff) Files.delete(path);
      }
    }
  }

  /**
   * Prunes one flat chunk directory.
   *
   * <p>Any file with a numeric timestamp prefix is eligible, matching the legacy
   * ObjectHistoryRecorder behavior.
   */
  public static void pruneFlatDirectory(Path dir, long cutoff) throws IOException {
    if (!Files.exists(dir)) return;
    try (var paths = Files.list(dir)) {
      for (Path path : paths.filter(Files::isRegularFile).toList()) {
        Long timestamp = timestampPrefix(path.getFileName().toString());
        if (timestamp != null && timestamp < cutoff) Files.deleteIfExists(path);
      }
    }
  }

  private static Long timestampPrefix(String name) {
    int dot = name.indexOf('.');
    if (dot <= 0) return null;
    try {
      return Long.parseLong(name.substring(0, dot));
    } catch (NumberFormatException ignored) {
      return null;
    }
  }
}
