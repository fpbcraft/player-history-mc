package dev.playerhistory.bluemap;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import dev.playerhistory.core.JsonFiles;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.lang.reflect.InvocationTargetException;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;
import javax.imageio.ImageIO;
import net.minecraft.server.MinecraftServer;

/**
 * Publishes complete Minecraft skins for historical 3D player models.
 *
 * <p>BlueMap already has the configured SkinProvider, including custom/offline providers.
 * Reusing it means Player History never needs Mojang credentials or a second skin cache.
 */
final class PlayerSkinPublisher implements AutoCloseable {
  private final Consumer<String> log;
  private final ExecutorService worker;
  private final Set<UUID> queued = ConcurrentHashMap.newKeySet();
  private final Set<UUID> published = ConcurrentHashMap.newKeySet();
  private volatile Object api;
  private volatile Path skinsRoot;
  private long nextRegistryScan;

  PlayerSkinPublisher(Consumer<String> log) {
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
    try {
      Files.createDirectories(skinsRoot);
      try (var files = Files.list(skinsRoot)) {
        for (Path file : files.filter(path -> path.toString().endsWith(".png")).toList()) {
          String name = file.getFileName().toString();
          try {
            published.add(UUID.fromString(name.substring(0, name.length() - 4)));
          } catch (RuntimeException ignored) {
          }
        }
      }
    } catch (IOException error) {
      log.accept("Cannot prepare historical player skins: " + error);
    }
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
      log.accept("Could not inspect Player History registry for skins: " + error);
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

      Path target = currentRoot.resolve(uuid + ".png");
      Files.createDirectories(target.getParent());
      Path temp = target.resolveSibling(target.getFileName() + ".tmp");
      if (!ImageIO.write(skin, "PNG", temp.toFile()))
        throw new IOException("No PNG writer available");
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
      log.accept("Could not load skin for " + uuid + ": " + (cause == null ? error : cause));
    } catch (ReflectiveOperationException | IOException | RuntimeException error) {
      log.accept("Could not publish skin for " + uuid + ": " + error);
    }
  }

  @Override
  public void close() {
    worker.shutdownNow();
  }
}
