package dev.playerhistory.object;

import static org.junit.jupiter.api.Assertions.*;

import java.io.*;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ObjectHistoryTest {
  @TempDir Path root;

  private static ObjectSnapshot snapshot(
      String id, double x, float qy, float qw, long geometry) {
    return new ObjectSnapshot(
        id,
        "Test " + id,
        "minecraft:overworld",
        x,
        64,
        0,
        0,
        qy,
        0,
        qw,
        1,
        1,
        1,
        geometry);
  }

  @Test
  void binaryRoundTripAndPartialRecovery() throws Exception {
    long start = 1_780_000_000_000L;
    var a = ObjectPoint.at(1, start + 100, 0, snapshot("a", 1, 0, 1, 7), ObjectPoint.BREAK);
    var b = ObjectPoint.at(1, start + 600, 0, snapshot("a", 2.5, .2f, .98f, 7), 0);

    var bytes = new ByteArrayOutputStream();
    ObjectBinaryCodec.header(new DataOutputStream(bytes), start, 300_000);
    byte[] frame = ObjectBinaryCodec.frame(List.of(a, b), start);
    bytes.write(frame);

    var read = ObjectBinaryCodec.read(new ByteArrayInputStream(bytes.toByteArray()));
    assertEquals(List.of(a, b), read.points());
    assertFalse(read.partial());

    bytes.write(frame, 0, frame.length - 2);
    read = ObjectBinaryCodec.read(new ByteArrayInputStream(bytes.toByteArray()));
    assertTrue(read.partial());
    assertEquals(List.of(a, b), read.points());
  }

  @Test
  void samplesMovementRotationGeometryAndDeparture() throws Exception {
    long now = System.currentTimeMillis();
    long start = Math.floorDiv(now, 60_000) * 60_000;
    var options = new ObjectHistoryRecorder.Options(60_000, -1, 64, .25, 1, 30_000);

    try (var recorder =
        new ObjectHistoryRecorder(root.resolve("objects"), options, ignored -> {})) {
      recorder.providerSnapshot("create_contraptions", List.of(snapshot("train/0", 0, 0, 1, 1)), now);
      recorder.providerSnapshot(
          "create_contraptions", List.of(snapshot("train/0", .1, 0, 1, 1)), now + 250);
      recorder.providerSnapshot(
          "create_contraptions", List.of(snapshot("train/0", 1, 0, 1, 1)), now + 500);
      recorder.providerSnapshot(
          "create_contraptions",
          List.of(snapshot("train/0", 1, .0872f, .9962f, 1)),
          now + 750);
      recorder.providerSnapshot(
          "create_contraptions",
          List.of(snapshot("train/0", 1, .0872f, .9962f, 2)),
          now + 1000);
      recorder.providerSnapshot("create_contraptions", List.of(), now + 1250);
    }

    Path file = root.resolve("objects/tracks/" + start + ".bin");
    assertTrue(Files.exists(file));
    ObjectBinaryCodec.Read read;
    try (var in = Files.newInputStream(file)) {
      read = ObjectBinaryCodec.read(in);
    }

    // initial + movement + rotation + geometry + explicit disappearance
    assertEquals(5, read.points().size());
    assertTrue((read.points().getFirst().flags() & ObjectPoint.BREAK) != 0);
    assertEquals(2, read.points().get(3).geometry());
    assertTrue((read.points().getLast().flags() & ObjectPoint.OFFLINE) != 0);
  }

  @Test
  void publishesSeparateObjectDataset() throws Exception {
    long now = System.currentTimeMillis();
    var options = new ObjectHistoryRecorder.Options(60_000, -1, 64, .25, 1, 30_000);
    Path publicRoot = root.resolve("public");

    try (var recorder =
        new ObjectHistoryRecorder(root.resolve("objects"), options, ignored -> {})) {
      recorder.publishTo(publicRoot);
      recorder.providerSnapshot("sable_ships", List.of(snapshot("ship", 10, 0, 1, 42)), now);
    }

    assertTrue(Files.exists(publicRoot.resolve("objects/manifest.json")));
    assertTrue(Files.exists(publicRoot.resolve("objects/live.json")));
    try (var reader = Files.newBufferedReader(publicRoot.resolve("objects/manifest.json"))) {
      var manifest =
          dev.playerhistory.core.JsonFiles.GSON.fromJson(
              reader, com.google.gson.JsonObject.class);
      assertEquals(32, manifest.get("positionScale").getAsInt());
      assertTrue(manifest.get("geometryArchive").getAsBoolean());
      assertTrue(manifest.getAsJsonArray("geometries").isEmpty());
    }
  }
  @Test
  void archivesAndRewritesBlueMap3DGeometry() throws Exception {
    long now = System.currentTimeMillis();
    var options = new ObjectHistoryRecorder.Options(60_000, -1, 64, .25, 1, 30_000);
    Path publicRoot = root.resolve("public");
    Path sourceMesh = root.resolve("live.bm3d");
    Path sourceAtlas = root.resolve("live.png");

    byte[] oldUrl = "assets/live.png".getBytes(StandardCharsets.UTF_8);
    int oldTail = 20 + ((oldUrl.length + 3) & ~3);
    byte[] bm3d = new byte[oldTail + 4];
    bm3d[0] = 'B';
    bm3d[1] = 'M';
    bm3d[2] = '3';
    bm3d[3] = 'D';
    ByteBuffer.wrap(bm3d).order(ByteOrder.LITTLE_ENDIAN).putInt(16, oldUrl.length);
    System.arraycopy(oldUrl, 0, bm3d, 20, oldUrl.length);
    bm3d[oldTail] = 99;
    Files.write(sourceMesh, bm3d);
    Files.write(sourceAtlas, new byte[] {1, 2, 3});

    try (var recorder =
        new ObjectHistoryRecorder(root.resolve("objects"), options, ignored -> {})) {
      recorder.publishTo(publicRoot);
      recorder.providerSnapshot(
          "create_contraptions", List.of(snapshot("train/0", 0, 0, 1, 7)), now);
      recorder.archiveGeometry(
          "create_contraptions", "train/0", 7, sourceMesh, sourceAtlas);
    }

    com.google.gson.JsonObject manifest;
    try (var reader = Files.newBufferedReader(publicRoot.resolve("objects/manifest.json"))) {
      manifest =
          dev.playerhistory.core.JsonFiles.GSON.fromJson(
              reader, com.google.gson.JsonObject.class);
    }
    var geometry = manifest.getAsJsonArray("geometries").get(0).getAsJsonObject();
    Path archived =
        publicRoot.resolve("objects").resolve(geometry.get("mesh").getAsString());
    Path atlas =
        publicRoot.resolve("objects").resolve(geometry.get("atlas").getAsString());
    assertTrue(Files.isRegularFile(archived));
    assertArrayEquals(new byte[] {1, 2, 3}, Files.readAllBytes(atlas));

    byte[] rewritten = Files.readAllBytes(archived);
    ByteBuffer header = ByteBuffer.wrap(rewritten).order(ByteOrder.LITTLE_ENDIAN);
    int length = header.getInt(16);
    String rewrittenUrl = new String(rewritten, 20, length, StandardCharsets.UTF_8);
    assertTrue(rewrittenUrl.startsWith("player-history/data/objects/geometry/"));
    int newTail = 20 + ((length + 3) & ~3);
    assertEquals(99, rewritten[newTail]);
  }

}
