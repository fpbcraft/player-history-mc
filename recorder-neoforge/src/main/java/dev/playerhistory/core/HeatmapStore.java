package dev.playerhistory.core;

import java.io.*;
import java.nio.file.*;
import java.util.*;

/**
 * Worker-owned incremental aggregates. A segment is split across time buckets before spatial cells.
 */
public final class HeatmapStore {
  private final Path root;
  private final long duration;
  private final int size;
  private final Map<Long, Map<Heatmap.Cell, Double>> dirty = new HashMap<>();
  private final Set<Long> pendingHours = new HashSet<>();

  public HeatmapStore(Path root, long duration, int size) {
    this.root = root;
    this.duration = duration;
    this.size = size;
  }

  public void segment(Point a, Point b) throws IOException {
    if (!a.connects(b) || b.time() <= a.time()) return;
    if (b.time() - a.time() > 3_600_000)
      throw new IOException("Unexpected segment longer than one hour");
    for (long t = Math.floorDiv(a.time(), duration) * duration; t < b.time(); t += duration) {
      Map<Heatmap.Cell, Double> cells = dirty.get(t);
      if (cells == null) {
        cells = read(root.resolve("heatmap/chunk/" + t + ".json"));
        dirty.put(t, cells);
      }
      Heatmap.add(cells, a, b, t, t + duration, size);
      if (cells.size() > 1_000_000) throw new IOException("Heatmap cell cap exceeded");
    }
  }

  static Map<Heatmap.Cell, Double> read(Path file) throws IOException {
    var cells = new HashMap<Heatmap.Cell, Double>();
    if (!Files.exists(file)) return cells;
    try (var in = Files.newBufferedReader(file)) {
      for (double[] row : JsonFiles.GSON.fromJson(in, double[][].class))
        cells.merge(
            new Heatmap.Cell((int) row[0], (int) row[1], (int) row[2], (int) row[3]),
            row[4],
            Double::sum);
    }
    return cells;
  }

  public void flush(Path pub) throws IOException {
    flush(pub, false);
  }

  public void flush(Path pub, boolean derive) throws IOException {
    var hours = new HashSet<Long>();
    var days = new HashSet<Long>();
    for (var entry : dirty.entrySet()) {
      save("chunk", entry.getKey(), entry.getValue(), pub);
      pendingHours.add(Math.floorDiv(entry.getKey(), 3_600_000) * 3_600_000);
    }
    if (derive) {
      hours.addAll(pendingHours);
      pendingHours.clear();
    }
    for (long hour : hours) {
      rebuild("hour", "chunk", hour, 3_600_000, duration, pub);
      days.add(Math.floorDiv(hour, 86_400_000) * 86_400_000);
    }
    for (long day : days) rebuild("day", "hour", day, 86_400_000, 3_600_000, pub);
    dirty.clear();
  }

  private void rebuild(String level, String child, long start, long span, long step, Path pub)
      throws IOException {
    var cells = new HashMap<Heatmap.Cell, Double>();
    for (long t = start; t < start + span; t += step) {
      read(root.resolve("heatmap/" + child + "/" + t + ".json"))
          .forEach((k, v) -> cells.merge(k, v, Double::sum));
      if (cells.size() > 1_000_000) throw new IOException("Aggregate cell cap exceeded");
    }
    save(level, start, cells, pub);
  }

  private void save(String level, long start, Map<Heatmap.Cell, Double> cells, Path pub)
      throws IOException {
    var rows = Heatmap.rows(cells);
    JsonFiles.write(root.resolve("heatmap/" + level + "/" + start + ".json"), rows);
    if (pub != null) JsonFiles.write(pub.resolve("heatmap/" + level + "/" + start + ".json"), rows);
  }
}
