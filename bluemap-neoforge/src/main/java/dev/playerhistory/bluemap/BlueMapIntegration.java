package dev.playerhistory.bluemap;

import com.google.gson.Gson;
import java.nio.file.*;
import java.util.*;
import java.util.function.Consumer;
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

  static {
    var b = new ModConfigSpec.Builder();
    PUBLIC_DIRECTORY = b.define("public-directory", "player-history/public");
    SPEC = b.build();
  }

  private volatile Object api;
  private volatile Path worldRoot;
  private final Map<String, Object> levels = new HashMap<>();
  private final Consumer<String> log = s -> LoggerFactory.getLogger("PlayerHistoryBlueMap").info(s);

  public BlueMapIntegration(ModContainer container) {
    container.registerConfig(ModConfig.Type.COMMON, SPEC);
    NeoForge.EVENT_BUS.addListener(this::start);
    NeoForge.EVENT_BUS.addListener(this::stop);
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
                  });
    } catch (Exception ex) {
      log.accept("Cannot connect to BlueMap API: " + ex);
    }
  }

  private void start(ServerStartedEvent event) {
    worldRoot = event.getServer().getWorldPath(LevelResource.ROOT);
    event
        .getServer()
        .getAllLevels()
        .forEach(level -> levels.put(level.dimension().location().toString(), level));
    install();
  }

  private void stop(ServerStoppingEvent event) {
    worldRoot = null;
    levels.clear();
  }

  private static Object call(
      Object target, String iface, String method, Class<?>[] types, Object... args)
      throws ReflectiveOperationException {
    return Class.forName("de.bluecolored.bluemap.api." + iface)
        .getMethod(method, types)
        .invoke(target, args);
  }

  private synchronized void install() {
    if (api == null || worldRoot == null) return;
    try {
      Object web = call(api, "BlueMapAPI", "getWebApp", new Class<?>[0]);
      Path root =
          ((Path) call(web, "WebApp", "getWebRoot", new Class<?>[0])).resolve("player-history");
      Files.createDirectories(root);
      for (String name :
          List.of(
              "player-history-0.8.4.js",
              "replay-core-0.8.4.js",
              "replay-state-0.8.4.js",
              "bluemap-adapter-0.8.4.js",
              "player-history-0.8.4.css",
              "telemetry-0.8.4.js")) {
        try (var in = getClass().getResourceAsStream("/" + name)) {
          if (in == null) throw new IllegalStateException("Missing asset " + name);
          Files.copy(in, root.resolve(name), StandardCopyOption.REPLACE_EXISTING);
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
          log.accept(
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
      call(
          web,
          "WebApp",
          "registerScript",
          new Class<?>[] {String.class},
          "player-history/player-history-0.8.4.js");
      call(
          web,
          "WebApp",
          "registerStyle",
          new Class<?>[] {String.class},
          "player-history/player-history-0.8.4.css");
      log.accept("History viewer installed; public dataset: " + dataset);
    } catch (Exception ex) {
      log.accept(
          "Cannot install history viewer: "
              + ex
              + ". See docs/bluemap-addon.md for manual directory-link setup.");
    }
  }
}
