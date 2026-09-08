package dev.playerhistory.state;

import static org.junit.jupiter.api.Assertions.*;

import dev.playerhistory.core.*;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class StateTest {
  @TempDir Path root;

  @Test
  void checkpointDeltaDisabledAndBoundary() {
    var tracker = new StateTracker();
    assertEquals(
        "checkpoint",
        tracker
            .update(
                1, 10, 60000, 30000, Map.of("health", 20, "slot:0", Map.of("item", 1, "count", 3)))
            .kind());
    assertNull(
        tracker.update(
            1, 20, 60000, 30000, Map.of("health", 20, "slot:0", Map.of("item", 1, "count", 3))));
    var delta =
        tracker.update(
            1, 30, 60000, 30000, Map.of("health", 19, "slot:0", Map.of("item", 0, "count", 0)));
    assertEquals("delta", delta.kind());
    assertEquals(2, delta.values().size());
    var disabled = tracker.update(1, 40, 60000, 30000, Map.of("health", 19));
    assertTrue(disabled.values().containsKey("slot:0"));
    assertNull(disabled.values().get("slot:0"));
    assertTrue(JsonFiles.GSON.toJson(disabled).contains("\"slot:0\":null"));
    assertEquals("checkpoint", tracker.update(1, 60000, 60000, 30000, Map.of("health", 19)).kind());
    assertEquals("unknown", tracker.end(1, 61000).kind());
    assertEquals("checkpoint", tracker.update(1, 62000, 60000, 30000, Map.of("health", 20)).kind());
    tracker.reset(1);
    assertEquals("checkpoint", tracker.update(1, 62001, 60000, 30000, Map.of("health", 20)).kind());
  }

  private byte[] stream(StateRecord record) throws Exception {
    var bytes = new ByteArrayOutputStream();
    var out = new DataOutputStream(bytes);
    out.writeInt(StateCodec.MAGIC);
    out.writeInt(StateCodec.VERSION);
    bytes.write(StateCodec.frame(record));
    return bytes.toByteArray();
  }

  @Test
  void typedFramesAndCorruptionAreBounded() throws Exception {
    var values = new LinkedHashMap<String, Object>();
    values.put("health", 20.0);
    values.put(
        "slot:0",
        Map.of(
            "item",
            2.0,
            "count",
            4.0,
            "name",
            "Pick",
            "enchantments",
            Map.of("minecraft:fortune", 3.0)));
    values.put("food", null);
    var record = new StateRecord(1, 100, "checkpoint", values);
    byte[] bytes = stream(record);
    var read = StateCodec.read(new ByteArrayInputStream(bytes));
    assertEquals(List.of(record), read.records());
    assertFalse(read.partial());
    bytes[bytes.length - 1] ^= 1;
    read = StateCodec.read(new ByteArrayInputStream(bytes));
    assertTrue(read.partial());
    assertTrue(read.records().isEmpty());
    assertEquals(8, read.validBytes());
    assertThrows(
        IOException.class,
        () ->
            StateCodec.frame(
                new StateRecord(1, 1, "checkpoint", Map.of("text", "x".repeat(8193)))));
    assertThrows(IOException.class, () -> StateCodec.read(new ByteArrayInputStream(new byte[8])));
  }

  @Test
  void crashClosesRecoveredStateAndPreservesPrefix() throws Exception {
    Files.createDirectories(root.resolve("states"));
    Path tmp = root.resolve("states/0.tmp");
    Files.write(tmp, stream(new StateRecord(1, 100, "checkpoint", Map.of("health", 20))));
    Files.write(tmp, new byte[] {0, 1}, StandardOpenOption.APPEND);
    try (var store = new StateStore(root, 60000)) {
      store.append(new StateRecord(1, 200, "checkpoint", Map.of("health", 19)));
      store.flush(root.resolve("public"));
    }
    try (var in = Files.newInputStream(root.resolve("states/0.bin"))) {
      var records = StateCodec.read(in).records();
      assertEquals(3, records.size());
      assertEquals("unknown", records.get(1).kind());
      assertEquals(100, records.get(1).time());
    }
    assertTrue(Files.readString(root.resolve("public/states/0.json")).contains("unknown"));
  }

  @Test
  void stateOnlyDatasetPublishesAndSurvivesRestart() throws Exception {
    long t = System.currentTimeMillis(), bucket = Math.floorDiv(t, 60000) * 60000;
    var registry = new Registry(root.resolve("registry.json"));
    registry.player(UUID.randomUUID(), "Test");
    var options = new HistoryStore.Options(60000, -1, 64, 8, false);
    try (var store = new HistoryStore(root, registry, options, ignored -> {})) {
      store.capabilities(Map.of("health", true, "movement", false));
      store.publishTo(root.resolve("public"));
      assertTrue(
          store.offer(
              List.of(),
              List.of(),
              List.of(new StateRecord(1, t, "checkpoint", Map.of("health", 20)))));
    }
    assertTrue(Files.exists(root.resolve("public/states/" + bucket + ".json")));
    try (var store = new HistoryStore(root, registry, options, ignored -> {})) {
      store.publishTo(root.resolve("public"));
    }
    var manifest =
        JsonFiles.GSON.fromJson(
            Files.readString(root.resolve("public/manifest.json")),
            com.google.gson.JsonObject.class);
    assertEquals(2, manifest.get("protocolVersion").getAsInt());
    assertEquals(t, manifest.get("latestTimestamp").getAsLong());
    assertFalse(manifest.has("mapWorlds"));
    assertTrue(manifest.getAsJsonObject("capabilities").get("health").getAsBoolean());
  }
}
