package dev.playerhistory.bluemap;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.level.ChunkPos;

public final class TickLoadTracker {
  private static final int SAMPLE_EVERY_TICKS = 10;
  private static final Map<Key, Mutable> LOAD = new HashMap<>();
  private static final Map<Entity, Long> ENTITY_STARTS = new IdentityHashMap<>();

  private static int serverTickCounter;
  private static int sampledTicks;
  private static boolean sampling;

  private TickLoadTracker() {}

  public record Sample(
      String dimension,
      int x,
      int z,
      double mspt,
      double chunkMspt,
      double entityMspt,
      double blockEntityMspt,
      int entityTicks,
      int blockEntityTicks) {}

  public record Window(List<Sample> samples, int sampledTicks) {}

  private record Key(String dimension, long chunk) {}

  private static final class Mutable {
    long chunkNanos;
    long entityNanos;
    long blockEntityNanos;
    int entityTicks;
    int blockEntityTicks;
  }

  public static void beginServerTick() {
    sampling = (++serverTickCounter % SAMPLE_EVERY_TICKS) == 1;
    if (sampling) sampledTicks++;
  }

  public static void endServerTick() {
    sampling = false;
    ENTITY_STARTS.clear();
  }

  public static boolean sampling() {
    return sampling;
  }

  public static void recordChunk(ServerLevel level, ChunkPos pos, long nanos) {
    if (!sampling) return;
    record(level, pos.toLong(), nanos, 0, 0, 0, 0);
  }

  public static void recordBlockEntity(ServerLevel level, BlockPos pos, long nanos) {
    if (!sampling) return;
    record(level, new ChunkPos(pos).toLong(), 0, 0, nanos, 0, 1);
  }

  public static void entityPre(Entity entity) {
    if (!sampling || !(entity.level() instanceof ServerLevel)) return;
    ENTITY_STARTS.put(entity, System.nanoTime());
  }

  public static void entityPost(Entity entity) {
    if (!(entity.level() instanceof ServerLevel level)) return;
    Long start = ENTITY_STARTS.remove(entity);
    if (start == null) return;
    record(level, entity.chunkPosition().toLong(), 0, System.nanoTime() - start, 0, 1, 0);
  }

  public static Window drain() {
    int ticks = sampledTicks;
    sampledTicks = 0;

    if (ticks <= 0 || LOAD.isEmpty()) {
      LOAD.clear();
      return new Window(List.of(), Math.max(0, ticks));
    }

    double divisor = ticks;
    var result = new ArrayList<Sample>(LOAD.size());
    LOAD.forEach(
        (key, value) -> {
          ChunkPos pos = new ChunkPos(key.chunk());
          double chunkMspt = value.chunkNanos / divisor / 1_000_000.0;
          double entityMspt = value.entityNanos / divisor / 1_000_000.0;
          double blockEntityMspt = value.blockEntityNanos / divisor / 1_000_000.0;
          result.add(
              new Sample(
                  key.dimension(),
                  pos.x,
                  pos.z,
                  chunkMspt + entityMspt + blockEntityMspt,
                  chunkMspt,
                  entityMspt,
                  blockEntityMspt,
                  value.entityTicks,
                  value.blockEntityTicks));
        });
    LOAD.clear();
    return new Window(List.copyOf(result), ticks);
  }

  private static void record(
      ServerLevel level,
      long packedChunk,
      long chunkNanos,
      long entityNanos,
      long blockEntityNanos,
      int entityTicks,
      int blockEntityTicks) {
    String dimension = level.dimension().location().toString();
    Mutable value = LOAD.computeIfAbsent(new Key(dimension, packedChunk), ignored -> new Mutable());
    value.chunkNanos += Math.max(0, chunkNanos);
    value.entityNanos += Math.max(0, entityNanos);
    value.blockEntityNanos += Math.max(0, blockEntityNanos);
    value.entityTicks += entityTicks;
    value.blockEntityTicks += blockEntityTicks;
  }
}
