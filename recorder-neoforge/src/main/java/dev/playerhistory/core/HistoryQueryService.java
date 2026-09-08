package dev.playerhistory.core;

import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.function.Consumer;

public final class HistoryQueryService {
  public volatile long lastQueryNanos;
  private final Path root;
  private final long duration;
  private final Consumer<String> warning;

  public HistoryQueryService(Path root, long duration, Consumer<String> warning) {
    this.root = root;
    this.duration = duration;
    this.warning = warning;
  }

  public static List<Long> chunks(long from, long to, long duration) {
    if (to < from || to - from > 86_400_000L)
      throw new IllegalArgumentException("Raw query limited to 24 hours");
    var result = new ArrayList<Long>();
    for (long t = Math.floorDiv(from, duration) * duration; t <= to; t += duration) result.add(t);
    return result;
  }

  public BinaryCodec.Batch query(Set<Integer> players, long from, long to) throws IOException {
    long started = System.nanoTime();
    var points = new ArrayList<Point>();
    var events = new ArrayList<HistoryEvent>();
    for (long t : chunks(from, to, duration)) {
      Path file = root.resolve("tracks/" + t + ".bin");
      if (!Files.exists(file)) continue;
      try (var input = Files.newInputStream(file)) {
        var data = BinaryCodec.read(input).batch();
        // Return entire edge chunks: they include context and interpolation endpoints.
        data.points().stream()
            .filter(p -> players.isEmpty() || players.contains(p.player()))
            .forEach(points::add);
        data.events().stream()
            .filter(
                e ->
                    e.point().time() >= from
                        && e.point().time() <= to
                        && (players.isEmpty() || players.contains(e.point().player())))
            .forEach(events::add);

      } catch (IOException e) {
        warning.accept("Skipping corrupt chunk " + file + ": " + e);
      }
      if (points.size() > 2_000_000) throw new IOException("Query record limit exceeded");
    }
    lastQueryNanos = System.nanoTime() - started;
    return new BinaryCodec.Batch(points, events);
  }
}
