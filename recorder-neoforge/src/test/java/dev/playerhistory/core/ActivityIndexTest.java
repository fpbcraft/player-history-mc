package dev.playerhistory.core;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.file.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ActivityIndexTest {
  @TempDir Path root;

  private Point p(long time, int flags) {
    return Point.at(1, time, 0, 0, 0, 0, flags);
  }

  private long[][] rows() throws Exception {
    try (var in = Files.newBufferedReader(root.resolve("activity/0.json"))) {
      return JsonFiles.GSON.fromJson(in, long[][].class);
    }
  }

  @Test
  void countsExcludeContextAndReplacementDoesNotDoubleCount() throws Exception {
    ActivityIndex.publish(
        root, 0, 300000, List.of(p(1000, 0), p(2000, 0), p(2000, Point.CONTEXT), p(120000, 0)));
    var first = rows();
    assertEquals(2, first.length);
    assertArrayEquals(new long[] {0, 2}, first[0]);
    ActivityIndex.publish(root, 300000, 300000, List.of(p(360000, 0)));
    ActivityIndex.publish(root, 0, 300000, List.of(p(1000, 0)));
    var replaced = rows();
    assertEquals(2, replaced.length);
    assertArrayEquals(new long[] {0, 1}, replaced[0]);
    assertArrayEquals(new long[] {360000, 1}, replaced[1]);
  }
}
