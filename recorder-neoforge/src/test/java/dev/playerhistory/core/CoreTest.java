package dev.playerhistory.core;

import static org.junit.jupiter.api.Assertions.*;

import java.io.*;
import java.nio.file.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class CoreTest {
  @TempDir Path root;

  private Point p(long t, double x, double z, int flags) {
    return Point.at(1, t, 0, x, -32, z, flags);
  }

  @Test
  void binaryRoundTripAndPartialRecovery() throws Exception {
    long t = 1_780_000_000_000L;
    var points =
        List.of(
            p(t, -100, 100, Point.BREAK),
            p(t + 500, -99.25, 98, 0),
            p(t + 1000, 30_000_000, -30_000_000, Point.BREAK),
            new Point(2, t + 1200, 123, -123, -999, 10, Point.OFFLINE));
    var event = new HistoryEvent(points.get(2), "CUSTOM", "{\"x\":true}");
    var out = new ByteArrayOutputStream();
    BinaryCodec.header(new DataOutputStream(out), t, 300000);
    byte[] frame = BinaryCodec.frame(new BinaryCodec.Batch(points, List.of(event)), t);
    out.write(frame);
    var read = BinaryCodec.read(new ByteArrayInputStream(out.toByteArray()));
    assertEquals(points, read.batch().points());
    assertEquals(List.of(event), read.batch().events());
    out.write(frame, 0, frame.length - 3);
    read = BinaryCodec.read(new ByteArrayInputStream(out.toByteArray()));
    assertTrue(read.partial());
    assertEquals(points, read.batch().points());
  }

  @Test
  void samplingPreservesStopAndDeparture() {
    var s = new Sampler(.25, 30000);
    var out = new ArrayList<Point>();
    s.sample(p(0, 0, 0, 0), out::add);
    s.sample(p(500, 2, 0, 0), out::add);
    s.sample(p(1000, 2, 0, 0), out::add);
    s.sample(p(20000, 2, 0, 0), out::add);
    s.sample(p(20500, 4, 0, 0), out::add);
    assertTrue(out.stream().anyMatch(p -> p.time() == 1000));
    assertTrue(out.stream().anyMatch(p -> p.time() == 20000));
    assertFalse(out.stream().anyMatch(p -> p.time() > 1000 && p.time() < 20000));
  }

  @Test
  void heatmapIndependentOfSamplingAndBreaks() {
    var coarse = List.of(p(0, -16, 0, 0), p(1000, 16, 0, 0));
    var fine = new ArrayList<Point>();
    for (int i = 0; i <= 4; i++) fine.add(p(i * 250, -16 + i * 8, 0, 0));
    var a = Heatmap.aggregate(coarse, 0, 1000, 8);
    var b = Heatmap.aggregate(fine, 0, 1000, 8);
    assertEquals(a.keySet(), b.keySet());
    a.forEach((cell, d) -> assertEquals(d, b.get(cell), .001));
    assertEquals(1000, a.values().stream().mapToDouble(Double::doubleValue).sum(), .001);
    assertTrue(
        Heatmap.aggregate(List.of(p(0, 0, 0, 0), p(1000, 16, 0, Point.BREAK)), 0, 1000, 8)
            .isEmpty());
    assertEquals(
        1000,
        Heatmap.aggregate(List.of(p(0, 0, 0, 0), p(1000, 0, 0, Point.OFFLINE)), 0, 1000, 8)
            .values()
            .iterator()
            .next(),
        .001);
  }

  @Test
  void selectsOnlyRequestedChunks() {
    assertEquals(List.of(300000L, 600000L), HistoryQueryService.chunks(300001, 600001, 300000));
    assertThrows(
        IllegalArgumentException.class, () -> HistoryQueryService.chunks(0, 100000000, 300000));
  }

  @Test
  void retentionKeepsCurrentFiles() throws Exception {
    Files.writeString(root.resolve("100.bin"), "");
    Files.writeString(root.resolve("200.bin"), "");
    RetentionFiles.pruneHistoryTree(root, 200);
    assertFalse(Files.exists(root.resolve("100.bin")));
    assertTrue(Files.exists(root.resolve("200.bin")));
  }

  @Test
  void absentVisibilityWorksButFailureCloses() {
    assertTrue(VisibilityPolicy.allow(false, true, false, VisibilityPolicy.Provider.ABSENT));
    assertFalse(VisibilityPolicy.allow(false, true, false, VisibilityPolicy.Provider.UNAVAILABLE));
    assertFalse(VisibilityPolicy.allow(false, true, true, VisibilityPolicy.Provider.ABSENT));
    assertFalse(VisibilityPolicy.allow(true, false, false, VisibilityPolicy.Provider.VISIBLE));
  }

  @Test
  void writerRestartSameBucketAndCorruptIsolation() throws Exception {
    var registry = new Registry(root.resolve("registry.json"));
    registry.player(UUID.randomUUID(), "Test");
    registry.world("minecraft:overworld");
    long t = System.currentTimeMillis();
    var opt = new HistoryStore.Options(300000, -1, 64, 8, true);
    try (var store = new HistoryStore(root, registry, opt, System.out::println)) {
      assertTrue(store.offer(List.of(p(t, 0, 0, Point.BREAK), p(t + 500, 1, 0, 0)), List.of()));
    }
    try (var store = new HistoryStore(root, registry, opt, System.out::println)) {
      assertTrue(store.offer(List.of(p(t + 1000, 2, 0, Point.BREAK)), List.of()));
    }
    var query = new HistoryQueryService(root, 300000, System.out::println);
    assertTrue(query.query(Set.of(), t, t + 2000).points().stream().anyMatch(p -> p.time() == t));
    Files.write(
        root.resolve("tracks/" + (Math.floorDiv(t, 300000) * 300000 + 300000) + ".bin"),
        new byte[] {1, 2});
    assertFalse(query.query(Set.of(), t, t + 300001).points().isEmpty());
  }

  @Test
  void crossChunkHeatmapsKeepBothPlayersAndAllTime() throws Exception {
    var heat = new HeatmapStore(root, 60000, 8);
    heat.segment(p(59000, 0, 0, 0), p(61000, 16, 0, 0));
    heat.segment(new Point(2, 59000, 0, 0, 0, 0, 0), new Point(2, 61000, 0, 0, 0, 0, 0));
    heat.flush(null, true);
    var before = HeatmapStore.read(root.resolve("heatmap/chunk/0.json"));
    var after = HeatmapStore.read(root.resolve("heatmap/chunk/60000.json"));
    assertEquals(2000, before.values().stream().mapToDouble(Double::doubleValue).sum(), .001);
    assertEquals(2000, after.values().stream().mapToDouble(Double::doubleValue).sum(), .001);
    assertEquals(
        Set.of(1, 2),
        before.keySet().stream()
            .map(Heatmap.Cell::player)
            .collect(java.util.stream.Collectors.toSet()));
  }

  @Test
  void overloadPersistsAnExplicitBreak() throws Exception {
    var registry = new Registry(root.resolve("registry.json"));
    registry.player(UUID.randomUUID(), "Test");
    registry.world("minecraft:overworld");
    long time = System.currentTimeMillis();
    try (var store =
        new HistoryStore(
            root, registry, new HistoryStore.Options(300000, -1, 1, 8, false), ignored -> {})) {
      for (int i = 0; i < 10000; i++) store.offer(List.of(p(time + i, 0, 0, 0)), List.of());
      long deadline = System.nanoTime() + 2_000_000_000L;
      while (!store.offer(List.of(p(time + 20000, 100, 0, 0)), List.of())
          && System.nanoTime() < deadline) Thread.sleep(10);
      assertTrue(store.dropped.get() > 0);
    }
    var data =
        new HistoryQueryService(root, 300000, ignored -> {}).query(Set.of(), time, time + 30000);
    assertTrue(data.points().stream().anyMatch(p -> p.flags() == (Point.OFFLINE | Point.BREAK)));
    assertTrue(
        data.points().stream()
            .anyMatch(p -> p.time() == time + 20000 && (p.flags() & Point.BREAK) != 0));
  }

  @Test
  void recoversTemporaryChunkAndClosesUnfinishedSession() throws Exception {
    Files.createDirectories(root.resolve("tracks"));
    long t = System.currentTimeMillis(), start = Math.floorDiv(t, 300000) * 300000;
    var bytes = new ByteArrayOutputStream();
    BinaryCodec.header(new DataOutputStream(bytes), start, 300000);
    bytes.write(
        BinaryCodec.frame(
            new BinaryCodec.Batch(List.of(p(t, 0, 0, Point.BREAK)), List.of()), start));
    bytes.write(new byte[] {0, 0, 1});
    Files.write(root.resolve("tracks/" + start + ".tmp"), bytes.toByteArray());
    try (var store =
        new HistoryStore(
            root,
            new Registry(root.resolve("registry.json")),
            new HistoryStore.Options(300000, -1, 64, 8, false),
            ignored -> {})) {}
    var result = new HistoryQueryService(root, 300000, ignored -> {}).query(Set.of(), t, t + 1);
    assertEquals(2, result.points().size());
    assertFalse(result.points().getLast().online());
  }
}
