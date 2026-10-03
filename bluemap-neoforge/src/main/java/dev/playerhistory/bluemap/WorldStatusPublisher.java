package dev.playerhistory.bluemap;

import com.google.gson.Gson;
import dev.playerhistory.core.LogSink;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.Map;
import java.util.TreeMap;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.GameRules;

/** Publishes small live world-state samples consumed by the BlueMap browser addon. */
final class WorldStatusPublisher {
  private static final int PUBLISH_INTERVAL_TICKS = 20;
  private static final Gson GSON = new Gson();

  record DimensionStatus(long dayTime, boolean daylightCycle, boolean hasSkyLight) {}

  record Snapshot(int version, long generatedAt, Map<String, DimensionStatus> dimensions) {}

  private final LogSink log;
  private volatile MinecraftServer server;
  private volatile Path output;
  private int ticks;

  WorldStatusPublisher(LogSink log) {
    this.log = log;
  }

  void start(MinecraftServer server, Path webRoot) {
    this.server = server;
    this.output = webRoot.resolve("player-history/world-status.json");
    this.ticks = 0;
    publish();
  }

  void stop() {
    server = null;
    output = null;
    ticks = 0;
  }

  void tick(MinecraftServer current) {
    if (current == null || output == null) return;
    if (++ticks < PUBLISH_INTERVAL_TICKS) return;
    ticks = 0;
    publish();
  }

  private void publish() {
    MinecraftServer current = server;
    Path destination = output;
    if (current == null || destination == null) return;

    try {
      Map<String, DimensionStatus> dimensions = new TreeMap<>();
      for (ServerLevel level : current.getAllLevels()) {
        dimensions.put(
            level.dimension().location().toString(),
            new DimensionStatus(
                level.getDayTime(),
                level.getGameRules().getBoolean(GameRules.RULE_DAYLIGHT),
                level.dimensionType().hasSkyLight()));
      }
      atomicWrite(
          destination,
          GSON.toJson(new Snapshot(1, System.currentTimeMillis(), dimensions)));
    } catch (Exception error) {
      log.warn("Could not publish BlueMap world status: " + error);
    }
  }

  private static void atomicWrite(Path path, String contents) throws Exception {
    Files.createDirectories(path.getParent());
    Path temp = path.resolveSibling(path.getFileName() + ".tmp");
    Files.writeString(
        temp,
        contents,
        StandardCharsets.UTF_8,
        StandardOpenOption.CREATE,
        StandardOpenOption.TRUNCATE_EXISTING,
        StandardOpenOption.WRITE);
    try {
      Files.move(
          temp,
          path,
          StandardCopyOption.ATOMIC_MOVE,
          StandardCopyOption.REPLACE_EXISTING);
    } catch (AtomicMoveNotSupportedException error) {
      Files.move(temp, path, StandardCopyOption.REPLACE_EXISTING);
    }
  }
}
