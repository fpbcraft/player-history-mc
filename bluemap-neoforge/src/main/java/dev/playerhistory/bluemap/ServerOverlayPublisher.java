package dev.playerhistory.bluemap;

import com.google.gson.Gson;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.function.Consumer;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.ChunkPos;

final class ServerOverlayPublisher {
  private static final int PUBLISH_INTERVAL_TICKS = 40;
  private static final Gson GSON = new Gson();


  record ChunkCell(int x, int z) {}
  record EntityCell(int x, int z, int total, int living, int items, int players) {}
  record DimensionData(
      List<ChunkCell> loaded,
      List<ChunkCell> pinned,
      List<EntityCell> entities,
      List<ClaimsOverlaySource.ClaimCell> claims) {}
  record Snapshot(int version, long generatedAt, Map<String, DimensionData> dimensions) {}

  private final Consumer<String> log;  private final Consumer<String> log;
  private final ClaimsOverlaySource claims;
  private volatile MinecraftServer server;
  private volatile Path output;
  private int ticks;

  ServerOverlayPublisher(Consumer<String> log) {
    this.log = log;
    this.claims = ClaimsOverlaySource.create(log);
  }

  void start(MinecraftServer server, Path webRoot) {
    MinecraftServer previous = this.server;
    this.server = server;
    this.output = webRoot.resolve("player-history/server-overlays.json");
    this.ticks = 0;
    if (previous != server) {
      claims.stop();
      claims.start(server);
    }
    publish();
  }

  void webRoot(Path webRoot) {
    if (webRoot != null) output = webRoot.resolve("player-history/server-overlays.json");
  }

  void stop() {
    claims.stop();
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
      var claimByDimension = new HashMap<String, List<ClaimsOverlaySource.ClaimCell>>();
      for (var claim : claims.snapshot())
        claimByDimension.computeIfAbsent(claim.dimension(), ignored -> new ArrayList<>()).add(claim);

      Map<String, DimensionData> dimensions = new TreeMap<>();
      for (ServerLevel level : current.getAllLevels()) {
        String key = level.dimension().location().toString();
        List<ClaimsOverlaySource.ClaimCell> dimensionClaims =
            List.copyOf(claimByDimension.getOrDefault(key, List.of()));
        List<ChunkCell> loaded = loadedChunks(level);
        dimensions.put(
            key,
            new DimensionData(
                loaded,
                pinnedChunks(level, dimensionClaims),
                entityDensity(level),
                dimensionClaims));
      }
      atomicWrite(
          destination,
          GSON.toJson(new Snapshot(2, System.currentTimeMillis(), dimensions)));
    } catch (Exception error) {
      log.accept("Could not publish BlueMap server overlays: " + error);
    }
  }

  private static List<ChunkCell> pinnedChunks(
      ServerLevel level, List<ClaimsOverlaySource.ClaimCell> claims) {
    var positions = new HashSet<Long>();
    for (long packed : level.getForcedChunks()) positions.add(packed);
    for (var claim : claims)
      if (claim.forceLoadMarked()) positions.add(ChunkPos.asLong(claim.x(), claim.z()));

    var result = new ArrayList<ChunkCell>(positions.size());
    for (long packed : positions) {
      ChunkPos pos = new ChunkPos(packed);
      result.add(new ChunkCell(pos.x, pos.z));
    }
    return result;
  }

  private static List<EntityCell> entityDensity(ServerLevel level) {
    record Mutable(int[] values) {}
    Map<Long, Mutable> counts = new HashMap<>();
    for (Entity entity : level.getAllEntities()) {
      ChunkPos pos = entity.chunkPosition();
      long key = pos.toLong();
      int[] value = counts.computeIfAbsent(key, ignored -> new Mutable(new int[4])).values();
      value[0]++;
      if (entity instanceof LivingEntity) value[1]++;
      if (entity instanceof ItemEntity) value[2]++;
      if (entity instanceof Player) value[3]++;
    }
    var result = new ArrayList<EntityCell>(counts.size());
    counts.forEach(
        (packed, mutable) -> {
          ChunkPos pos = new ChunkPos(packed);
          int[] value = mutable.values();
          result.add(new EntityCell(pos.x, pos.z, value[0], value[1], value[2], value[3]));
        });
    return result;
  }

  private static List<ChunkCell> loadedChunks(ServerLevel level) {
    var result = new ArrayList<ChunkCell>();
    try {
      Object source = level.getChunkSource();
      Field chunkMapField = findField(source.getClass(), "chunkMap");
      Object chunkMap = chunkMapField.get(source);
      Method getChunks = findMethod(chunkMap.getClass(), "getChunks");
      Object value = getChunks.invoke(chunkMap);
      if (!(value instanceof Iterable<?> holders)) return result;
      for (Object holder : holders) {
        Method getChunkToSend = findMethod(holder.getClass(), "getChunkToSend");
        if (getChunkToSend.invoke(holder) == null) continue;
        Method getPos = findMethod(holder.getClass(), "getPos");
        Object pos = getPos.invoke(holder);
        if (pos instanceof ChunkPos chunk) result.add(new ChunkCell(chunk.x, chunk.z));
      }
    } catch (ReflectiveOperationException ignored) {
      // Keep the overlay optional if pinned MC/NeoForge internals move.
    }
    return result;
  }

  private static Field findField(Class<?> type, String name) throws ReflectiveOperationException {
    for (Class<?> current = type; current != null; current = current.getSuperclass()) {
      try {
        Field field = current.getDeclaredField(name);
        field.setAccessible(true);
        return field;
      } catch (NoSuchFieldException ignored) {}
    }
    throw new NoSuchFieldException(name);
  }

  private static Method findMethod(Class<?> type, String name) throws ReflectiveOperationException {
    Method method = findOptionalMethod(type, name);
    if (method != null) return method;
    throw new NoSuchMethodException(name);
  }

  private static Method findOptionalMethod(Class<?> type, String name) {
    for (Class<?> current = type; current != null; current = current.getSuperclass()) {
      try {
        Method method = current.getDeclaredMethod(name);
        method.setAccessible(true);
        return method;
      } catch (NoSuchMethodException ignored) {}
    }
    return null;
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
