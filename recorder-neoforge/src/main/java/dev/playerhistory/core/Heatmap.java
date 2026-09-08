package dev.playerhistory.core;

import java.util.*;

/** Exact parametric grid crossings, retaining player identity in every aggregate. */
public final class Heatmap {
  public record Cell(int player, int world, int x, int z) {}

  public static Map<Cell, Double> aggregate(List<Point> points, long from, long to, int size) {
    var result = new HashMap<Cell, Double>();
    var last = new HashMap<Integer, Point>();
    for (var b : points) {
      var a = last.put(b.player(), b);
      if (a != null) add(result, a, b, from, to, size);
    }
    return result;
  }

  static void add(Map<Cell, Double> out, Point a, Point b, long from, long to, int size) {
    if (!a.connects(b) || b.time() <= a.time()) return;
    long lo = Math.max(a.time(), from), hi = Math.min(b.time(), to);
    if (hi <= lo) return;
    double r0 = (double) (lo - a.time()) / (b.time() - a.time()),
        r1 = (double) (hi - a.time()) / (b.time() - a.time());
    // HOLD on the departure point means it is a stationary anchor, not a frozen future segment.
    double ax = a.x() / 32.0,
        az = a.z() / 32.0,
        dx = (b.x() - (double) a.x()) / 32,
        dz = (b.z() - (double) a.z()) / 32;
    double t = r0;
    int steps = 0;
    while (t < r1 && steps++ < 100_000) {
      double probe = Math.min(r1, t + 1e-10), x = ax + dx * probe, z = az + dz * probe;
      int cx = (int) Math.floor(x / size), cz = (int) Math.floor(z / size);
      double tx =
          dx == 0
              ? Double.POSITIVE_INFINITY
              : ((dx > 0 ? (cx + 1.0) * size : cx * (double) size) - ax) / dx;
      double tz =
          dz == 0
              ? Double.POSITIVE_INFINITY
              : ((dz > 0 ? (cz + 1.0) * size : cz * (double) size) - az) / dz;
      double next = Math.min(r1, Math.min(tx, tz));
      if (next <= t) next = Math.min(r1, t + 1e-9);
      out.merge(
          new Cell(a.player(), a.world(), cx, cz), (next - t) * (b.time() - a.time()), Double::sum);
      t = next;
    }
    if (t < r1)
      throw new IllegalArgumentException(
          "Segment crosses too many heatmap cells; missing teleport integration");
  }

  public static List<double[]> rows(Map<Cell, Double> cells) {
    return cells.entrySet().stream()
        .map(
            e ->
                new double[] {
                  e.getKey().player, e.getKey().world, e.getKey().x, e.getKey().z, e.getValue()
                })
        .toList();
  }
}
