package dev.playerhistory.bluemap;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import dev.playerhistory.core.JsonFiles;
import dev.playerhistory.core.LogSink;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.lang.reflect.InvocationTargetException;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import javax.imageio.ImageIO;
import net.minecraft.server.MinecraftServer;

/**
 * Publishes complete Minecraft skins for historical 3D player models.
 *
 * <p>BlueMap already has the configured SkinProvider, including custom/offline providers.
 * Reusing it means Player History never needs Mojang credentials or a second skin cache.
 */
final class PlayerSkinPublisher implements AutoCloseable {
  private final LogSink log;
  private final ExecutorService worker;
  private final Set<UUID> queued = ConcurrentHashMap.newKeySet();
  private final Set<UUID> published = ConcurrentHashMap.newKeySet();
  private volatile Object api;
  private volatile Path skinsRoot;
  private long nextRegistryScan;

  PlayerSkinPublisher(LogSink log) {
    this.log = log;
    this.worker =
        Executors.newSingleThreadExecutor(
            runnable -> {
              Thread thread = new Thread(runnable, "player-history-skins");
              thread.setDaemon(true);
              thread.setPriority(Thread.NORM_PRIORITY - 1);
              return thread;
            });
  }

  void configure(Object blueMapApi, Path webRoot) {
    api = blueMapApi;
    skinsRoot = webRoot.resolve("player-history/skins").normalize();
    published.clear();
    queued.clear();
    try {
      Files.createDirectories(skinsRoot);
      // Do not trust a PNG left by an older Player History build. Fetch each player's
      // complete skin once per server process so stale skin assets cannot survive upgrades.
    } catch (IOException error) {
      log.warn("Cannot prepare historical player skins: " + error);
    }
  }

  void disable() {
    api = null;
    skinsRoot = null;
  }

  void tick(MinecraftServer server, Path worldRoot) {
    if (api == null || skinsRoot == null) return;
    for (var player : server.getPlayerList().getPlayers()) queue(player.getUUID());

    long now = System.currentTimeMillis();
    if (worldRoot != null && now >= nextRegistryScan) {
      nextRegistryScan = now + 30_000;
      queueRegistry(worldRoot.resolve("player-history/registry.json"));
    }
  }

  private void queueRegistry(Path registry) {
    if (!Files.isRegularFile(registry)) return;
    try (var reader = Files.newBufferedReader(registry)) {
      JsonObject root = JsonFiles.GSON.fromJson(reader, JsonObject.class);
      JsonArray players = root == null ? null : root.getAsJsonArray("players");
      if (players == null) return;
      for (var value : players) {
        if (!value.isJsonObject()) continue;
        var uuid = value.getAsJsonObject().get("uuid");
        if (uuid == null || !uuid.isJsonPrimitive()) continue;
        try {
          queue(UUID.fromString(uuid.getAsString()));
        } catch (IllegalArgumentException ignored) {
        }
      }
    } catch (IOException | RuntimeException error) {
      log.warn("Could not inspect Player History registry for skins: " + error);
    }
  }

  private void queue(UUID uuid) {
    if (published.contains(uuid) || !queued.add(uuid)) return;
    worker.execute(
        () -> {
          try {
            publish(uuid);
          } finally {
            queued.remove(uuid);
          }
        });
  }

  private void publish(UUID uuid) {
    Object currentApi = api;
    Path currentRoot = skinsRoot;
    if (currentApi == null || currentRoot == null || published.contains(uuid)) return;

    try {
      Object plugin = currentApi.getClass().getMethod("getPlugin").invoke(currentApi);
      Object provider = plugin.getClass().getMethod("getSkinProvider").invoke(plugin);
      Object loaded = provider.getClass().getMethod("load", UUID.class).invoke(provider, uuid);
      if (!(loaded instanceof Optional<?> optional) || optional.isEmpty()) return;
      Object image = optional.get();
      if (!(image instanceof BufferedImage skin)) return;

      int sourceWidth = skin.getWidth();
      int sourceHeight = skin.getHeight();
      skin = normalizeSkin(skin);

      Path target = currentRoot.resolve(uuid + ".png");
      Files.createDirectories(target.getParent());
      Path temp = target.resolveSibling(target.getFileName() + ".tmp");

      try (var out = Files.newOutputStream(temp)) {
        if (!ImageIO.write(skin, "PNG", out))
          throw new IOException("No PNG writer available");
      }
      try {
        Files.move(
            temp,
            target,
            StandardCopyOption.REPLACE_EXISTING,
            StandardCopyOption.ATOMIC_MOVE);
      } catch (AtomicMoveNotSupportedException ignored) {
        Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING);
      }
      published.add(uuid);
    } catch (InvocationTargetException error) {
      Throwable cause = error.getCause();
      log.warn("Could not load skin for " + uuid + ": " + (cause == null ? error : cause));
    } catch (ReflectiveOperationException | IOException | RuntimeException error) {
      log.warn("Could not publish skin for " + uuid + ": " + error);
    }
  }

  /**
   * Converts legacy pre-1.8 skins (64x32, and integer-scaled equivalents) to the modern
   * square layout used by the 3D renderer. The mapping mirrors skinview-utils exactly:
   * the old right leg/arm are mirrored into the modern left leg/arm slots.
   *
   * <p>Old skins also commonly use fully opaque pixels in the unused hat area. Minecraft
   * clients treat those as legacy padding, not as a solid second head layer. If the source
   * contains no transparent pixels at all, clear that helmet layer after conversion; this
   * is the same compatibility rule used by skinview3d/skinview-utils.
   */
  private static BufferedImage normalizeSkin(BufferedImage source) {
    int width = source.getWidth();
    int height = source.getHeight();

    if (width == height) {
      BufferedImage modern = copyArgb(source, width, height);
      if (!hasTransparency(modern, 0, 0, width, height)) {
        clearModernOuterLayers(modern, width / 64);
      }
      return modern;
    }

    if (width != height * 2 || width % 64 != 0) {
      return copyArgb(source, width, height);
    }

    int scale = width / 64;
    BufferedImage modern = new BufferedImage(width, width, BufferedImage.TYPE_INT_ARGB);
    for (int y = 0; y < height; y++) {
      for (int x = 0; x < width; x++) {
        modern.setRGB(x, y, source.getRGB(x, y));
      }
    }

    mirrorCopy(source, modern, 4, 16, 4, 4, 20, 48, scale);
    mirrorCopy(source, modern, 8, 16, 4, 4, 24, 48, scale);
    mirrorCopy(source, modern, 0, 20, 4, 12, 24, 52, scale);
    mirrorCopy(source, modern, 4, 20, 4, 12, 20, 52, scale);
    mirrorCopy(source, modern, 8, 20, 4, 12, 16, 52, scale);
    mirrorCopy(source, modern, 12, 20, 4, 12, 28, 52, scale);

    mirrorCopy(source, modern, 44, 16, 4, 4, 36, 48, scale);
    mirrorCopy(source, modern, 48, 16, 4, 4, 40, 48, scale);
    mirrorCopy(source, modern, 40, 20, 4, 12, 40, 52, scale);
    mirrorCopy(source, modern, 44, 20, 4, 12, 36, 52, scale);
    mirrorCopy(source, modern, 48, 20, 4, 12, 32, 52, scale);
    mirrorCopy(source, modern, 52, 20, 4, 12, 44, 52, scale);

    if (!hasTransparency(source, 0, 0, width, height)) {
      // Legacy compatibility: only the helmet layer existed in 64x32 skins.
      clear(modern, 40, 0, 8, 8, scale);
      clear(modern, 48, 0, 8, 8, scale);
      clear(modern, 32, 8, 8, 8, scale);
      clear(modern, 40, 8, 8, 8, scale);
      clear(modern, 48, 8, 8, 8, scale);
      clear(modern, 56, 8, 8, 8, scale);
    }

    return modern;
  }

  private static BufferedImage copyArgb(BufferedImage source, int width, int height) {
    BufferedImage copy = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
    for (int y = 0; y < height; y++) {
      for (int x = 0; x < width; x++) {
        copy.setRGB(x, y, source.getRGB(x, y));
      }
    }
    return copy;
  }

  private static void mirrorCopy(
      BufferedImage source,
      BufferedImage target,
      int sx,
      int sy,
      int w,
      int h,
      int dx,
      int dy,
      int scale) {
    int sw = w * scale;
    int sh = h * scale;
    int sourceX = sx * scale;
    int sourceY = sy * scale;
    int targetX = dx * scale;
    int targetY = dy * scale;
    for (int y = 0; y < sh; y++) {
      for (int x = 0; x < sw; x++) {
        target.setRGB(targetX + (sw - 1 - x), targetY + y, source.getRGB(sourceX + x, sourceY + y));
      }
    }
  }

  private static boolean hasTransparency(
      BufferedImage image, int x, int y, int width, int height) {
    for (int py = y; py < y + height; py++) {
      for (int px = x; px < x + width; px++) {
        if (((image.getRGB(px, py) >>> 24) & 0xff) < 0xff) return true;
      }
    }
    return false;
  }

  private static void clearModernOuterLayers(BufferedImage image, int scale) {
    int[][] areas = {
      {40, 0, 8, 8}, {48, 0, 8, 8}, {32, 8, 8, 8}, {40, 8, 8, 8},
      {48, 8, 8, 8}, {56, 8, 8, 8},

      {4, 32, 4, 4}, {8, 32, 4, 4}, {0, 36, 4, 12}, {4, 36, 4, 12},
      {8, 36, 4, 12}, {12, 36, 4, 12},

      {20, 32, 8, 4}, {28, 32, 8, 4}, {16, 36, 4, 12}, {20, 36, 8, 12},
      {28, 36, 4, 12}, {32, 36, 8, 12},

      {44, 32, 4, 4}, {48, 32, 4, 4}, {40, 36, 4, 12}, {44, 36, 4, 12},
      {48, 36, 4, 12}, {52, 36, 12, 12},

      {4, 48, 4, 4}, {8, 48, 4, 4}, {0, 52, 4, 12}, {4, 52, 4, 12},
      {8, 52, 4, 12}, {12, 52, 4, 12},

      {52, 48, 4, 4}, {56, 48, 4, 4}, {48, 52, 4, 12}, {52, 52, 4, 12},
      {56, 52, 4, 12}, {60, 52, 4, 12}
    };
    for (int[] area : areas) clear(image, area[0], area[1], area[2], area[3], scale);
  }

  private static void clear(
      BufferedImage image, int x, int y, int width, int height, int scale) {
    for (int py = y * scale; py < (y + height) * scale; py++) {
      for (int px = x * scale; px < (x + width) * scale; px++) {
        image.setRGB(px, py, 0x00000000);
      }
    }
  }

  @Override
  public void close() {
    worker.shutdownNow();
  }
}
