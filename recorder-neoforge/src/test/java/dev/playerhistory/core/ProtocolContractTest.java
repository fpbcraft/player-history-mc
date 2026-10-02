package dev.playerhistory.core;

import static org.junit.jupiter.api.Assertions.*;

import com.google.gson.JsonObject;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ProtocolContractTest {
  @TempDir Path root;

  private JsonObject fixture(String name) throws Exception {
    var input = ProtocolContractTest.class.getClassLoader().getResourceAsStream(name);
    assertNotNull(input, "missing shared protocol fixture " + name);
    try (var reader = new InputStreamReader(input, StandardCharsets.UTF_8)) {
      return JsonFiles.GSON.fromJson(reader, JsonObject.class);
    }
  }

  @Test
  void sharedManifestFixturePinsPublicProtocolVersionAndShape() throws Exception {
    JsonObject fixture = fixture("manifest-v2.json");
    assertEquals(2, fixture.get("protocolVersion").getAsInt());
    assertEquals(1, fixture.get("formatVersion").getAsInt());
    assertEquals(60_000, fixture.get("chunkDurationMs").getAsLong());
    assertTrue(fixture.has("registry"));
    assertTrue(fixture.has("capabilities"));
    assertTrue(fixture.has("trackingEnabled"));
    assertTrue(fixture.has("chunkRanges"));
  }

  @Test
  void recorderManifestMatchesSharedContract() throws Exception {
    var registry = new Registry(root.resolve("registry.json"));
    int player =
        registry.player(
            UUID.fromString("00000000-0000-0000-0000-000000000001"), "Fixture");
    int world = registry.world("minecraft:overworld");
    registry.item("minecraft:stone");

    long time = 1_780_000_000_000L;
    Path publication = root.resolve("public");
    try (var store =
        new HistoryStore(
            root,
            registry,
            new HistoryStore.Options(60_000, -1, 64, 8, false),
            message -> {})) {
      store.capabilities(Map.of("movement", true, "chat", true));
      store.publishTo(publication);
      assertTrue(
          store.offer(
              List.of(Point.at(player, time, world, 1, 64, -2, Point.BREAK)),
              List.of()));
    }

    JsonObject manifest =
        JsonFiles.GSON.fromJson(
            Files.readString(publication.resolve("manifest.json")), JsonObject.class);
    JsonObject fixture = fixture("manifest-v2.json");

    assertEquals(
        fixture.get("protocolVersion").getAsInt(),
        manifest.get("protocolVersion").getAsInt());
    assertEquals(fixture.get("formatVersion").getAsInt(), manifest.get("formatVersion").getAsInt());
    assertEquals(
        fixture.get("chunkDurationMs").getAsLong(),
        manifest.get("chunkDurationMs").getAsLong());
    assertEquals(fixture.get("cellSize").getAsInt(), manifest.get("cellSize").getAsInt());

    var players = manifest.getAsJsonObject("registry").getAsJsonArray("players");
    assertEquals("Fixture", players.get(0).getAsJsonObject().get("name").getAsString());
    assertTrue(manifest.getAsJsonObject("capabilities").get("movement").getAsBoolean());
    assertTrue(manifest.has("trackingEnabled"));
    assertTrue(manifest.has("chunkRanges"));
  }
}
