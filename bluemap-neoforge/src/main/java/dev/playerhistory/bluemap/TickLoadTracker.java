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
  private static final Object LOCK = new Object();
  private static final Map<Key, Mutable> LOAD = new HashMap<>();
  private static final Map<Entity, Long> ENTITY_STARTS = new IdentityHashMap<>();

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

  private record Key(String dimension, long chunk) {}

  private static final class Mutable {
    long chunkNanos;
    long entityNanos;
    long blockEntityNanos;
    int entityTicks;
    int blockEntityTicks;
  }

  public static void recordChunk(ServerLevel level, ChunkPos pos, long nanos) {
    record(level, pos.toLong(), nanos, 0, 0, 0, 0);
  }

  public static void recordBlockEntity(ServerLevel level, BlockPos pos, long nanos) {
    record(level, ChunkPos.asLong(pos), 0, 0, nanos, 0, 1);
  }

  public static void entityPre(Entity entity) {
    if (!(entity.level() instanceof ServerLevel)) return;
    synchronized (LOCK) {
      ENTITY_STARTS.put(entity, System.nanoTime());
    }
  }

  public static void entityPost(Entity entity) {
    if (!(entity.level() instanceof ServerLevel level)) return;
    long start;
    synchronized (LOCK) {
      Long value = ENTITY_STARTS.remove(entity);
      if (value == null) return;
      start = value;
    }
    record(level, entity.chunkPosition().toLong(), 0, System.nanoTime() - start, 0, 1, 0);
  }

  public static List<Sample> drain(int serverTicks) {
    double ticks = Math.max(1, serverTicks);
    Map<Key, Mutable> snapshot;
    synchronized (LOCK) {
      snapshot = new HashMap<>(LOAD);
      LOAD.clear();
      ENTITY_STARTS.clear();
    }

    var result = new ArrayList<Sample>(snapshot.size());
    snapshot.forEach(
        (key, value) -> {
          ChunkPos pos = new ChunkPos(key.chunk());
          double chunkMspt = value.chunkNanos / ticks / 1_000_000.0;
          double entityMspt = value.entityNanos / ticks / 1_000_000.0;
          double blockEntityMspt = value.blockEntityNanos / ticks / 1_000_000.0;
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
    return result;
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
    synchronized (LOCK) {
      Mutable value = LOAD.computeIfAbsent(new Key(dimension, packedChunk), ignored -> new Mutable());
      value.chunkNanos += Math.max(0, chunkNanos);
      value.entityNanos += Math.max(0, entityNanos);
      value.blockEntityNanos += Math.max(0, blockEntityNanos);
      value.entityTicks += entityTicks;
      value.blockEntityTicks += blockEntityTicks;
    }
  }
}
