package dev.playerhistory.assets;

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
public final class WorldStatusPublisher {
  private static final int PUBLISH_INTERVAL_TICKS = 20;

  record DimensionStatus(long dayTime, boolean daylightCycle, boolean hasSkyLight, String season) {}

  record Snapshot(int version, long generatedAt, Map<String, DimensionStatus> dimensions) {}

  private final LogSink log;
  private volatile MinecraftServer server;
  private volatile Path output;
  private int ticks;
  private PublicSnapshotWriter writer;

  public WorldStatusPublisher(LogSink log) {
    this.log = log;
  }

  public void start(MinecraftServer server, Path webRoot) {
    if (writer != null) writer.close();
    writer = new PublicSnapshotWriter(log);
    this.server = server;
    this.output = webRoot.resolve("player-history/world-status.json");
    this.ticks = 0;
    publish();
  }

  public void stop() {
    if (writer != null) writer.close();
    writer = null;
    server = null;
    output = null;
    ticks = 0;
  }

  public void tick(MinecraftServer current) {
    if (current == null || output == null) return;
    if (++ticks < PUBLISH_INTERVAL_TICKS) return;
    ticks = 0;
    publish();
  }

  private void publish() {
    MinecraftServer current = server;
    Path destination = output;
    if (current == null || destination == null || writer == null) return;

    try {
      Map<String, DimensionStatus> dimensions = new TreeMap<>();
      for (ServerLevel level : current.getAllLevels()) {
        dimensions.put(
            level.dimension().location().toString(),
            new DimensionStatus(
                level.getDayTime(),
                level.getGameRules().getBoolean(GameRules.RULE_DAYLIGHT),
                level.dimensionType().hasSkyLight(), SeasonStatus.season(level)));
      }
      writer.offer(destination, new Snapshot(1, System.currentTimeMillis(), dimensions));
    } catch (Exception error) {
      log.warn("Could not publish BlueMap world status: " + error);
    }
  }

}
