package dev.playerhistory.core;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.file.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class RetentionTest {
  @TempDir Path root;

  @Test
  void everyCategoryUsesUtcRetention() throws Exception {
    long day = Math.floorDiv(System.currentTimeMillis(), 86400000) * 86400000;
    for (int retention : List.of(-1, 0, 30)) {
      Path base = root.resolve("r" + retention), pub = base.resolve("public");
      Files.createDirectories(base);
      try (var store =
          new HistoryStore(
              base,
              new Registry(base.resolve("registry.json")),
              new HistoryStore.Options(60000, -1, 64, 8, false),
              ignored -> {})) {
        store.publishTo(pub);
        var directories =
            List.of(
                "tracks",
                "states",
                "heatmap/chunk",
                "heatmap/hour",
                "heatmap/day",
                "public/chunks",
                "public/states",
                "public/heatmap/chunk",
                "public/heatmap/day",
                "public/activity");
        for (String dir : directories)
          for (long age : List.of(0L, 1L, 30L, 31L))
            for (String ext : List.of(".bin", ".json", ".tmp", ".json.tmp", ".tmp.corrupt")) {
              Path file = base.resolve(dir + "/" + (day - age * 86400000) + ext);
              Files.createDirectories(file.getParent());
              Files.writeString(file, "");
            }
        store.retentionDays(retention);
        store.retention(day + 3600000);
        for (String dir : directories)
          for (long age : List.of(0L, 1L, 30L, 31L))
            for (String ext : List.of(".bin", ".json", ".tmp", ".json.tmp", ".tmp.corrupt"))
              assertEquals(
                  retention < 0 || age <= retention,
                  Files.exists(base.resolve(dir + "/" + (day - age * 86400000) + ext)),
                  dir + age + ext);
      }
    }
  }
}
