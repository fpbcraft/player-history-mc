package dev.playerhistory.bluemap;

import com.google.gson.Gson;
import dev.playerhistory.core.LogSink;
import java.nio.file.*;
import java.util.*;
import java.util.function.Consumer;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.level.storage.LevelResource;
import net.neoforged.fml.ModContainer;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.config.ModConfig;
import net.neoforged.neoforge.common.*;
import net.neoforged.neoforge.event.server.*;
import org.slf4j.LoggerFactory;

/** The bridge installs visualization assets and maps dimensions; it never reads private tracks. */
@Mod("playerhistory_bluemap")
public final class BlueMapIntegration {
  private static final ModConfigSpec SPEC;
  private static final ModConfigSpec.ConfigValue<String> PUBLIC_DIRECTORY;
  private static final ModConfigSpec.BooleanValue OBJECT_HISTORY;
  private static final ModConfigSpec.IntValue OBJECT_SAMPLE_INTERVAL;
  private static final ModConfigSpec.ConfigValue<List<? extends String>> OBJECT_PROVIDERS;

  static {
    var b = new ModConfigSpec.Builder();
    PUBLIC_DIRECTORY = b.define("public-directory", "player-history/public");
    OBJECT_HISTORY = b.define("object-history.enabled", true);
    OBJECT_SAMPLE_INTERVAL =
        b.defineInRange("object-history.sample-interval-ms", 500, 50, 60_000);
    OBJECT_PROVIDERS =
        b.defineListAllowEmpty(
            "object-history.providers",
            List.of(),
            () -> "",
            value -> value instanceof String);
    SPEC = b.build();
  }

  private final String version;
  private volatile Object api;
  private volatile Path worldRoot;
  private volatile MinecraftServer server;
  private final Map<String, Object> levels = new HashMap<>();
  private final LogSink log = LogSink.slf4j(LoggerFactory.getLogger("PlayerHistoryBlueMap"));
  private final BlueMap3DHistoryBridge objectHistory = new BlueMap3DHistoryBridge(log);
  private final PlayerSkinPublisher skins = new PlayerSkinPublisher(log);
  private final EquipmentAssetPublisher equipment = new EquipmentAssetPublisher(log);
  private final ServerOverlayPublisher serverOverlays = new ServerOverlayPublisher(log);
  private final WorldStatusPublisher worldStatus = new WorldStatusPublisher(log);

  public BlueMapIntegration(ModContainer container) {
    version = container.getModInfo().getVersion().toString();
    container.registerConfig(ModConfig.Type.COMMON, SPEC);
    NeoForge.EVENT_BUS.addListener(this::start);
    NeoForge.EVENT_BUS.addListener(this::stop);
    NeoForge.EVENT_BUS.addListener(this::tick);
    try {
      var type = Class.forName("de.bluecolored.bluemap.api.BlueMapAPI");
      type.getMethod("onEnable", Consumer.class)
          .invoke(
              null,
              (Consumer<Object>)
                  a -> {
                    api = a;
                    install();
                  });
      type.getMethod("onDisable", Consumer.class)
          .invoke(
              null,
              (Consumer<Object>)
                  a -> {
                    api = null;
                    objectHistory.webRoot(null);
                    skins.disable();
                    equipment.disable();
                    serverOverlays.stop();
                    worldStatus.stop();
                  });
    } catch (Exception ex) {
      log.warn("Cannot connect to BlueMap API: " + ex);
    }
  }

  private void start(ServerStartedEvent event) {
    server = event.getServer();
    worldRoot = server.getWorldPath(LevelResource.ROOT);
    event
        .getServer()
        .getAllLevels()
        .forEach(level -> levels.put(level.dimension().location().toString(), level));
    install();
  }

  private void stop(ServerStoppingEvent event) {
    objectHistory.reset();
    equipment.disable();
    serverOverlays.stop();
    worldStatus.stop();
    server = null;
    worldRoot = null;
    levels.clear();
  }

  private void tick(net.neoforged.neoforge.event.tick.ServerTickEvent.Post event) {
    objectHistory.tick(
        event, OBJECT_HISTORY.get(), OBJECT_SAMPLE_INTERVAL.get(), OBJECT_PROVIDERS.get());
    skins.tick(event.getServer(), worldRoot);
    equipment.tick(worldRoot);
    serverOverlays.tick(event.getServer());
    worldStatus.tick(event.getServer());
  }

  private static Object call(
      Object target, String iface, String method, Class<?>[] types, Object... args)
      throws ReflectiveOperationException {
    return Class.forName("de.bluecolored.bluemap.api." + iface)
        .getMethod(method, types)
        .invoke(target, args);
  }

  @SuppressWarnings("unchecked")
  private void removeLegacyRegistrations(Object web, Path assetRoot) {
    String currentScript = "player-history/player-history-" + version + ".js";
    String currentStyle = "player-history/player-history-" + version + ".css";
    try {
      var serviceField = web.getClass().getDeclaredField("blueMapService");
      serviceField.setAccessible(true);
      Object service = serviceField.get(web);
      Object manager = service.getClass().getMethod("getWebFilesManager").invoke(service);

      Set<String> scripts =
          (Set<String>) manager.getClass().getMethod("getScripts").invoke(manager);
      Set<String> styles =
          (Set<String>) manager.getClass().getMethod("getStyles").invoke(manager);

      // Game-time UI originally shipped from bluemap3d-patches. Player History now owns it;
      // remove the persisted registration and old web files so the two runtimes cannot coexist.
      scripts.remove("assets/bluemap3d/game-time-sync.js");
      Path webRoot = assetRoot.getParent();
      if (webRoot != null) {
        Files.deleteIfExists(webRoot.resolve("assets/bluemap3d/game-time-sync.js"));
        Files.deleteIfExists(webRoot.resolve("assets/bluemap3d/game-time-sync.core.js"));
        Files.deleteIfExists(webRoot.resolve("assets/bluemap3d/game-time.json"));
      }

      scripts.removeIf(
          url ->
              url.startsWith("player-history/player-history-")
                  && url.endsWith(".js")
                  && !url.equals(currentScript));
      styles.removeIf(
          url ->
              url.startsWith("player-history/player-history-")
                  && url.endsWith(".css")
                  && !url.equals(currentStyle));

      manager.getClass().getMethod("saveSettings").invoke(manager);

      try (var files = Files.list(assetRoot)) {
        for (Path file : files.toList()) {
          String name = file.getFileName().toString();
          if ((name.startsWith("player-history-") && name.endsWith(".js")
                  && !name.equals("player-history-" + version + ".js"))
              || (name.startsWith("player-history-") && name.endsWith(".css")
                  && !name.equals("player-history-" + version + ".css"))) {
            Files.deleteIfExists(file);
          }
        }
      }
    } catch (ReflectiveOperationException | java.io.IOException error) {
      // BlueMap has no public unregister API. Failure here is non-fatal, but keeping
      // stale versioned URLs can cause an older cached custom element to win at startup.
      log.warn("Could not remove stale Player History web registrations: " + error);
    }
  }

  private synchronized void install() {
    if (api == null || worldRoot == null) return;
    try {
      Object web = call(api, "BlueMapAPI", "getWebApp", new Class<?>[0]);
      Path webRoot =
          ((Path) call(web, "WebApp", "getWebRoot", new Class<?>[0]))
              .toAbsolutePath()
              .normalize();
      objectHistory.webRoot(webRoot);
      skins.configure(api, webRoot);
      equipment.configure(webRoot, worldRoot);
      Path root = webRoot.resolve("player-history");
      Files.createDirectories(root);
      if (server != null) {
        serverOverlays.start(server, webRoot);
        worldStatus.start(server, webRoot);
      }
      for (String name : List.of("player-history.js", "player-history.css")) {
        try (var in = getClass().getResourceAsStream("/" + name)) {
          if (in == null) throw new IllegalStateException("Missing asset " + name);
          int extension = name.lastIndexOf('.');
          String installed = name.substring(0, extension) + "-" + version + name.substring(extension);
          Files.copy(in, root.resolve(installed), StandardCopyOption.REPLACE_EXISTING);
        }
      }
      Path configured = Path.of(PUBLIC_DIRECTORY.get());
      Path dataset =
          (configured.isAbsolute() ? configured : worldRoot.resolve(configured))
              .toAbsolutePath()
              .normalize();
      Files.createDirectories(dataset);
      Path link = root.resolve("data");
      if (!link.toAbsolutePath().normalize().equals(dataset)) {
        if (Files.exists(link, LinkOption.NOFOLLOW_LINKS)
            && !(Files.isSymbolicLink(link) && Files.readSymbolicLink(link).equals(dataset))) {
          Path backup = root.resolve("legacy-data-" + System.currentTimeMillis());
          Files.move(link, backup);
          log.info(
              "Preserved previous public history at "
                  + backup
                  + "; remove it explicitly when migration is confirmed.");
        }
        if (!Files.exists(link, LinkOption.NOFOLLOW_LINKS)) Files.createSymbolicLink(link, dataset);
      }
      var mapping = new TreeMap<String, String>();
      for (var level : levels.entrySet()) {
        var world =
            (Optional<?>)
                call(
                    api, "BlueMapAPI", "getWorld", new Class<?>[] {Object.class}, level.getValue());
        if (world.isPresent())
          for (Object map :
              (Collection<?>) call(world.get(), "BlueMapWorld", "getMaps", new Class<?>[0]))
            mapping.put((String) call(map, "BlueMapMap", "getId", new Class<?>[0]), level.getKey());
      }
      Files.writeString(
          root.resolve("integration.json"), new Gson().toJson(Map.of("mapWorlds", mapping)));
      removeLegacyRegistrations(web, root);
      call(
          web,
          "WebApp",
          "registerScript",
          new Class<?>[] {String.class},
          "player-history/player-history-" + version + ".js");
      call(
          web,
          "WebApp",
          "registerStyle",
          new Class<?>[] {String.class},
          "player-history/player-history-" + version + ".css");
      log.info("History viewer installed; public dataset: " + dataset);
    } catch (Exception ex) {
      log.warn(
          "Cannot install history viewer: "
              + ex
              + ". See docs/bluemap-addon.md for manual directory-link setup.");
    }
  }
}
