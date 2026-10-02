package dev.playerhistory.core;

import static org.junit.jupiter.api.Assertions.*;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class PublicProtocolContractTest {
  @TempDir Path root;

  @Test
  void recorderOutputMatchesSharedPublicProtocolFixtures() throws Exception {
    var registry = new Registry(root.resolve("registry.json"));
    registry.player(UUID.fromString("00000000-0000-0000-0000-000000000001"), "Test");
    registry.world("minecraft:overworld");

    long time = System.currentTimeMillis();
    long bucket = Math.floorDiv(time, 100) * 100;
    var options = new HistoryStore.Options(100, -1, 64, 8, false);

    try (var store = new HistoryStore(root, registry, options, ignored -> {})) {
      store.capabilities(Map.of("movement", true));
      store.publishTo(root.resolve("public"));
      assertTrue(
          store.offer(
              List.of(Point.at(1, time, 0, 0, 64, 0, Point.BREAK)),
              List.of()));
    }

    JsonObject actualManifest =
        JsonFiles.GSON.fromJson(
            Files.readString(root.resolve("public/manifest.json")), JsonObject.class);
    JsonObject actualChunk =
        JsonFiles.GSON.fromJson(
            Files.readString(root.resolve("public/chunks/" + bucket + ".json")),
            JsonObject.class);

    assertSameShape(fixture("manifest-v2.json"), actualManifest, "$manifest");
    assertSameShape(fixture("chunk-v2.json"), actualChunk, "$chunk");
  }

  private static JsonObject fixture(String name) throws Exception {
    var stream = PublicProtocolContractTest.class.getResourceAsStream("/" + name);
    assertNotNull(stream, "missing shared protocol fixture " + name);
    try (stream; var reader = new InputStreamReader(stream, StandardCharsets.UTF_8)) {
      return JsonFiles.GSON.fromJson(reader, JsonObject.class);
    }
  }

  private static void assertSameShape(JsonElement expected, JsonElement actual, String path) {
    assertNotNull(actual, "missing value at " + path);

    if (expected.isJsonObject()) {
      assertTrue(actual.isJsonObject(), "expected object at " + path);
      JsonObject expectedObject = expected.getAsJsonObject();
      JsonObject actualObject = actual.getAsJsonObject();
      Set<String> expectedKeys = expectedObject.keySet();
      assertEquals(expectedKeys, actualObject.keySet(), "object keys differ at " + path);
      for (String key : expectedKeys) {
        assertSameShape(expectedObject.get(key), actualObject.get(key), path + "." + key);
      }
      return;
    }

    if (expected.isJsonArray()) {
      assertTrue(actual.isJsonArray(), "expected array at " + path);
      JsonArray expectedArray = expected.getAsJsonArray();
      JsonArray actualArray = actual.getAsJsonArray();
      if (!expectedArray.isEmpty()) {
        assertFalse(actualArray.isEmpty(), "expected non-empty array at " + path);
        assertSameShape(expectedArray.get(0), actualArray.get(0), path + "[0]");
      }
      return;
    }

    assertTrue(actual.isJsonPrimitive(), "expected primitive at " + path);
    var expectedPrimitive = expected.getAsJsonPrimitive();
    var actualPrimitive = actual.getAsJsonPrimitive();
    assertEquals(expectedPrimitive.isBoolean(), actualPrimitive.isBoolean(), "boolean type differs at " + path);
    assertEquals(expectedPrimitive.isNumber(), actualPrimitive.isNumber(), "number type differs at " + path);
    assertEquals(expectedPrimitive.isString(), actualPrimitive.isString(), "string type differs at " + path);
  }
}
