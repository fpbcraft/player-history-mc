package dev.playerhistory.assets;

import com.google.gson.JsonParser;
import dev.playerhistory.config.HistoryConfig;
import dev.playerhistory.core.LogSink;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Supplier;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.level.storage.LevelResource;

/**
 * Optional, reflection-only integration with Diorama's dedicated web map.
 *
 * The frontend, CSS and versioned modules are served directly from this JAR by
 * Diorama's read-only extension API. Nothing is copied to the live web-map root,
 * and the private recorder directory is never mounted.
 */
final class DioramaWebBridge {
  private static final String ID = "player-history";
  private static final String PREFIX = "/player-history/";
  private static final String DATA_PREFIX = "/player-history/data/";
  private static final String API_PREFIX = "/player-history-api/";
  private static final String SCRIPT = PREFIX + "diorama-history.js";
  private static final String STYLE = PREFIX + "player-history.css";
  private static volatile Class<?> registeredWith;

  private DioramaWebBridge() {}

  static void start(MinecraftServer server, LogSink log, Supplier<Path> publishedAssets) {
    final Class<?> extensions;
    try {
      extensions = Class.forName("dev.diorama.web.WebExtensions");
    } catch (ClassNotFoundException missingDiorama) {
      return; // Ordinary BlueMap/recorder installation; no optional Diorama dependency.
    }
    Path worldRoot = server.getWorldPath(LevelResource.ROOT);
    try {
      List<String> files = new ArrayList<>();
      files.add("diorama-history.js");
      files.add("player-history.css");
      try (var in = DioramaWebBridge.class.getResourceAsStream("/player-history-assets.json")) {
        if (in == null) throw new IllegalStateException("Missing bundled frontend asset index");
        var json = JsonParser.parseReader(new InputStreamReader(in, StandardCharsets.UTF_8)).getAsJsonArray();
        for (var item : json) files.add(item.getAsString());
      }
      // Resources are packaged at the JAR root by public-assets-neoforge/processResources.
      extensions.getMethod("registerAssets", String.class, String.class, Class.class, String.class,
          List.class, List.class, List.class)
          .invoke(null, ID, PREFIX, DioramaWebBridge.class, "/", files, List.of(SCRIPT), List.of(STYLE));
      extensions.getMethod("registerPublicFiles", String.class, String.class, Supplier.class, List.class)
          .invoke(null, ID, PREFIX, publishedAssets,
              List.of("integration.json", "server-overlays.json", "world-status.json", "skins/", "equipment/"));

      if (HistoryConfig.PUBLISH.get()) {
        Path requested = Path.of(HistoryConfig.PUBLIC_DIRECTORY.get());
        Path data = (requested.isAbsolute() ? requested : worldRoot.resolve(requested))
            .toAbsolutePath().normalize();
        Path privateRoot = worldRoot.resolve("player-history").toAbsolutePath().normalize();
        Path defaultPublic = privateRoot.resolve("public");
        if (data.equals(worldRoot.toAbsolutePath().normalize()) || data.equals(privateRoot)
            || data.startsWith(privateRoot) && !data.startsWith(defaultPublic)) {
          throw new IllegalArgumentException("Configured public export overlaps private Player History files");
        }
        extensions.getMethod("registerPublicFiles", String.class, String.class, Supplier.class)
            .invoke(null, ID, DATA_PREFIX, (Supplier<Path>) () -> data);
      } else {
        log.warn("Diorama history extension enabled but recorder's public publishing is disabled");
      }

      if (HistoryConfig.WEBCHAT.get()) {
        if (HistoryConfig.WEBCHAT_BIND.get().equals("127.0.0.1")) {
          extensions.getMethod("registerLoopbackApi", String.class, String.class, int.class)
              .invoke(null, ID, API_PREFIX, HistoryConfig.WEBCHAT_PORT.get());
        } else {
          // Never silently expose an arbitrary remote chat API through the map server.
          log.warn("Diorama chat route not registered: webchat.bind must be 127.0.0.1. Use an HTTPS proxy if chat is needed.");
        }
      }
      registeredWith = extensions;
      log.info("Diorama web extension registered from Player History JAR; public history is mounted read-only");
    } catch (Exception error) {
      try { extensions.getMethod("unregister", String.class).invoke(null, ID); }
      catch (ReflectiveOperationException ignored) {}
      log.warn("Could not register Player History with Diorama Web: " + error);
    }
  }

  static void stop() {
    Class<?> host = registeredWith;
    registeredWith = null;
    if (host == null) return;
    try { host.getMethod("unregister", String.class).invoke(null, ID); }
    catch (ReflectiveOperationException ignored) {}
  }
}
