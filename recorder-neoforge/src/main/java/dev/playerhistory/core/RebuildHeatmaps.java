package dev.playerhistory.core;

import java.nio.file.*;
import java.util.*;

/** Offline maintenance tool. Writes a new destination, never mutates original tracks. */
public final class RebuildHeatmaps {
  public static void main(String[] args) throws Exception {
    if (args.length != 3)
      throw new IllegalArgumentException(
          "Usage: <history-root> <new-output-directory> <cell-size>");
    Path source = Path.of(args[0]), destination = Path.of(args[1]);
    if (Files.exists(destination))
      throw new IllegalArgumentException("Output directory must not exist");
    Files.createDirectories(destination);
    long count = 0;
    try (var files = Files.list(source.resolve("tracks"))) {
      HeatmapStore store = null;
      for (Path f : files.filter(p -> p.toString().endsWith(".bin")).sorted().toList()) {
        BinaryCodec.Read r;
        try (var in = Files.newInputStream(f)) {
          r = BinaryCodec.read(in);
        } catch (Exception e) {
          System.err.println("Skipping corrupt chunk " + f + ": " + e);
          continue;
        }
        if (store == null)
          store = new HeatmapStore(destination, r.duration(), Integer.parseInt(args[2]));
        var last = new HashMap<Integer, Point>();
        for (var p : r.batch().points()) {
          var previous = last.put(p.player(), p);
          if (previous != null) store.segment(previous, p);
          count++;
        }
        store.flush(null, true);
      }
    }
    System.out.println("Rebuilt aggregates from " + count + " points into " + destination);
  }
}
