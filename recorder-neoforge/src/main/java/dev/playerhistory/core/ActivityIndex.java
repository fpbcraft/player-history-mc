package dev.playerhistory.core;

import java.io.IOException;
import java.nio.file.*;
import java.util.*;

/** Replaceable, minute-resolution sample counts. Written only by the history worker. */
public final class ActivityIndex {
  private ActivityIndex() {}

  public static void publish(Path publicRoot, long start, long duration, List<Point> points)
      throws IOException {
    long day = Math.floorDiv(start, 86_400_000L) * 86_400_000L;
    Path file = publicRoot.resolve("activity/" + day + ".json");
    var bins = new TreeMap<Long, Long>();
    if (Files.exists(file)) {
      try (var reader = Files.newBufferedReader(file)) {
        long[][] rows = JsonFiles.GSON.fromJson(reader, long[][].class);
        for (long[] row : rows) bins.put(row[0], row[1]);
      }
    }
    bins.subMap(start, true, start + duration, false).clear();
    for (Point point : points) {
      if (!point.online()
          || (point.flags() & Point.CONTEXT) != 0
          || point.time() < start
          || point.time() >= start + duration) continue;
      long minute = Math.floorDiv(point.time(), 60_000L) * 60_000L;
      bins.merge(minute, 1L, Long::sum);
    }
    JsonFiles.write(
        file, bins.entrySet().stream().map(e -> new long[] {e.getKey(), e.getValue()}).toList());
  }
}
