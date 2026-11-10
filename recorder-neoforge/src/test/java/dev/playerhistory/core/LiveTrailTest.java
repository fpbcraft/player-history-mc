package dev.playerhistory.core;
import dev.playerhistory.state.StateRecord;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
class LiveTrailTest {
  @TempDir Path root;
  @Test void movementIsPublishedBeforeHistoricalBatch() throws Exception {
    var registry = new Registry(root.resolve("registry.json"));
    int player = registry.player(UUID.randomUUID(), "Tester"), world = registry.world("minecraft:overworld");
    try (var store = new HistoryStore(root, registry, new HistoryStore.Options(300000, -1, 64, 8, false), ignored -> {})) {
      store.publishTo(root.resolve("public"));
      // Let the writer complete its initial empty flush, then enqueue fresh movement.
      Thread.sleep(400);
      long now = System.currentTimeMillis();
      Point first = Point.at(player, now, world, 1, 64, 1, Point.BREAK);
      var state =
          new StateRecord(
              player,
              now,
              "checkpoint",
              Map.of("sneaking", true, "onGround", true, "heldItem", Map.of("item", 0, "count", 0)));
      assertTrue(
          store.offer(
              List.of(first, Point.at(player, now + 1, world, 2, 64, 1, 0)),
              List.of(),
              List.of(state)));
      boolean found = false, foundPresence = false, foundState = false;
      for (int i = 0; i < 30; i++) {
        Thread.sleep(50);
        Path live = root.resolve("public/live.json");
        if (Files.exists(live)) {
          var data = com.google.gson.JsonParser.parseString(Files.readString(live)).getAsJsonObject();
          found = data.getAsJsonArray("points").size() == 2;
          var states = data.getAsJsonObject("states");
          foundState =
              states != null
                  && states.has(String.valueOf(player))
                  && states
                      .getAsJsonObject(String.valueOf(player))
                      .get("sneaking")
                      .getAsBoolean();
        }
        Path presence = root.resolve("public/presence.json");
        if (Files.exists(presence)) {
          var data =
              com.google.gson.JsonParser.parseString(Files.readString(presence)).getAsJsonObject();
          var points = data.getAsJsonArray("points");
          foundPresence =
              points.size() == 1 && points.get(0).getAsJsonObject().get("x").getAsInt() == 64;
        }
        if (found && foundPresence && foundState) break;
      }
      assertTrue(found, "live feed contains new movement within 1.5 seconds");
      assertTrue(foundPresence, "presence feed contains only the latest player position");
      assertTrue(foundState, "live feed contains reconstructed current player state");
      Path historical = root.resolve("public/chunks/" + (now / 300000 * 300000) + ".json");
      assertFalse(Files.exists(historical), "historical batch is not flushed early");
    }
  }
  @Test void lastLocationsPersistAcrossRestartWithoutBecomingOnlinePresence() throws Exception {
    var registry = new Registry(root.resolve("registry.json"));
    int player = registry.player(UUID.randomUUID(), "Tester");
    int world = registry.world("minecraft:the_nether");
    var options = new HistoryStore.Options(300000, -1, 64, 8, false);
    long now = System.currentTimeMillis();
    try (var store = new HistoryStore(root, registry, options, ignored -> {})) {
      store.publishTo(root.resolve("public"));
      assertTrue(store.offer(List.of(Point.at(player, now, world, 10, 60, 20, Point.BREAK)), List.of()));
    }
    assertTrue(Files.exists(root.resolve("last-locations.json")));
    Files.deleteIfExists(root.resolve("public/presence.json"));
    try (var store = new HistoryStore(root, registry, options, ignored -> {})) {
      store.publishTo(root.resolve("public"));
      Path file = root.resolve("public/presence.json");
      for (int i = 0; i < 40 && !Files.exists(file); i++) Thread.sleep(50);
      assertTrue(Files.exists(file));
      var snapshot = com.google.gson.JsonParser.parseString(Files.readString(file)).getAsJsonObject();
      assertEquals(0, snapshot.getAsJsonArray("points").size());
      var locations = snapshot.getAsJsonArray("lastLocations");
      assertEquals(1, locations.size());
      var location = locations.get(0).getAsJsonObject();
      assertEquals(world, location.get("world").getAsInt());
      assertEquals(320, location.get("x").getAsInt());
      assertEquals(now, location.get("time").getAsLong());
      assertNotEquals(0, location.get("flags").getAsInt() & Point.OFFLINE);
    }
  }
}
