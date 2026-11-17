package dev.playerhistory.assets;

import static org.junit.jupiter.api.Assertions.*;

import dev.diorama.api.WebVehicleScene;
import dev.playerhistory.object.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class DioramaVehicleHistoryTest {
  @TempDir Path root;

  @Test
  void busyVehiclesDoNotFlushTheCacheForOtherActiveVehicles() {
    var bridge = new DioramaVehicleHistory(ignored -> {});
    bridge.rememberArchive("idle-old-version");
    bridge.rememberArchive("active-stable-vehicle");
    for (int i = 0; i < 4096; i++) {
      bridge.rememberArchive("turning-vehicle/" + i);
      assertTrue(bridge.hasArchive("active-stable-vehicle"));
    }
    assertFalse(bridge.hasArchive("idle-old-version"));
    assertTrue(bridge.hasArchive("turning-vehicle/4095"));
    assertTrue(bridge.hasArchive("turning-vehicle/4094"));
  }

  private void scene(long time, double x) {
    WebVehicleScene.snapshot = new WebVehicleScene.Snapshot(time, List.of(
        new WebVehicleScene.Vehicle("sable_ships", "ship", "Ship", "minecraft:overworld", 1,
            x, 64, 0, 0, 0, 0, 1, root.resolve("source.dspr"), null)));
  }

  @Test
  void historySamplingAndDisableDoNotStopLivePublicationsOrEraseRecordings() throws Exception {
    long start = 1_800_000_000_000L;
    var now = new AtomicLong(start + 10_000);
    WebVehicleScene.enabled = true;
    WebVehicleScene.interval = 500;
    var bridge = new DioramaVehicleHistory(ignored -> {}, now::get);
    var options = new ObjectHistoryRecorder.Options(60_000, -1, 64, .25, 1, 30_000);
    try (var recorder = new ObjectHistoryRecorder(root.resolve("objects"), options, ignored -> {})) {
      ObjectHistoryApi.install(recorder);
      scene(now.get(), 0); bridge.sample();
      now.addAndGet(100); scene(now.get(), 1); bridge.sample();
      now.addAndGet(400); scene(now.get(), 2); bridge.sample();
      WebVehicleScene.enabled = false;
      now.incrementAndGet(); bridge.sample();
      now.addAndGet(100); scene(now.get(), 3); bridge.sample();
      assertEquals(3, WebVehicleScene.latest().vehicles().getFirst().x());
      WebVehicleScene.enabled = true;
      now.addAndGet(100); scene(now.get(), 4); bridge.sample();
      WebVehicleScene.enabled = false;
      now.incrementAndGet(); bridge.sample();
      ObjectHistoryApi.clear(recorder);
    } finally {
      bridge.reset();
      WebVehicleScene.enabled = true;
    }
    try (var input = Files.newInputStream(root.resolve("objects/tracks/" + start + ".bin"))) {
      var points = ObjectBinaryCodec.read(input).points();
      assertEquals(5, points.size()); // initial, sampled movement, disabled, resumed, disabled
      assertEquals(List.of(true, true, false, true, false), points.stream().map(ObjectPoint::online).toList());
      assertEquals(2 * ObjectPoint.POSITION_SCALE, points.get(1).x());
      assertEquals(4 * ObjectPoint.POSITION_SCALE, points.get(3).x());
      assertTrue((points.get(3).flags() & ObjectPoint.BREAK) != 0);
    }
  }
}
