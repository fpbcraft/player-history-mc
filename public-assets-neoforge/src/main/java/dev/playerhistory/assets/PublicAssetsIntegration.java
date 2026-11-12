package dev.playerhistory.assets;

import dev.playerhistory.core.LogSink;
import java.nio.file.Path;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.level.storage.LevelResource;
import net.neoforged.fml.ModContainer;
import net.neoforged.fml.ModList;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.config.ModConfig;
import net.neoforged.neoforge.common.ModConfigSpec;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.server.ServerStartedEvent;
import net.neoforged.neoforge.event.server.ServerStoppingEvent;
import net.neoforged.neoforge.event.tick.ServerTickEvent;
import org.slf4j.LoggerFactory;

/** Owns the existing publishers only when the BlueMap bridge does not own them. */
@Mod("playerhistory_assets")
public final class PublicAssetsIntegration {
  private static final ModConfigSpec SPEC;
  private static final ModConfigSpec.ConfigValue<String> WEB_ROOT;
  static {
    var builder = new ModConfigSpec.Builder();
    WEB_ROOT = builder.comment("Public assets only; never point a web server at the recorder's private directory.")
        .define("web-root", "player-history-web");
    SPEC = builder.build();
  }
  private final LogSink log = LogSink.slf4j(LoggerFactory.getLogger("PlayerHistoryAssets"));
  private final ServerOverlayPublisher overlays;
  private final WorldStatusPublisher status;
  private final PlayerSkinPublisher skins;
  private final EquipmentAssetPublisher equipment;
  private Path worldRoot;
  private Path standaloneAssetRoot;
  private static volatile Path blueMapWebRoot;

  /** BlueMap's publisher remains the sole writer when its bridge is installed. */
  public static void blueMapWebRoot(Path root) {
    blueMapWebRoot = root;
  }

  private Path currentPublicAssetFolder() {
    if (ModList.get().isLoaded("playerhistory_bluemap")) {
      Path root = blueMapWebRoot;
      return root == null ? null : root.resolve("player-history");
    }
    Path root = standaloneAssetRoot;
    return root == null ? null : root.resolve("player-history");
  }

  public PublicAssetsIntegration(ModContainer container) {
    container.registerConfig(ModConfig.Type.COMMON, SPEC);
    // Both installed: the bridge retains its established lifecycle, paths and SkinProvider.
    // Do not sample entities, scan claims or write assets twice.
    if (ModList.get().isLoaded("playerhistory_bluemap")) {
      overlays = null; status = null; skins = null; equipment = null;
    } else {
      overlays = new ServerOverlayPublisher(log);
      status = new WorldStatusPublisher(log);
      skins = new PlayerSkinPublisher(log);
      equipment = new EquipmentAssetPublisher(log);
    }
    // Even when BlueMap owns the data publishers, Diorama must register its
    // own viewer and read-only paths independently.
    NeoForge.EVENT_BUS.addListener(this::start);
    NeoForge.EVENT_BUS.addListener(this::tick);
    NeoForge.EVENT_BUS.addListener(this::stop);
  }

  private void start(ServerStartedEvent event) {
    MinecraftServer server = event.getServer();
    worldRoot = server.getWorldPath(LevelResource.ROOT);
    Path root;
    try { root = PublicAssetPaths.resolve(worldRoot, Path.of(WEB_ROOT.get())); }
    catch (java.io.IOException | RuntimeException error) {
      log.warn("Refusing invalid public asset root: " + error);
      worldRoot = null;
      return;
    }
    standaloneAssetRoot = root;
    if (overlays != null) {
      overlays.start(server, root);
      status.start(server, root);
      skins.configureStandalone(root);
      equipment.configure(root, worldRoot);
    }
    DioramaWebBridge.start(server, log, this::currentPublicAssetFolder);
  }

  private void tick(ServerTickEvent.Post event) {
    if (worldRoot == null) return;
    if (overlays != null) {
      overlays.tick(event.getServer()); status.tick(event.getServer());
      skins.tick(event.getServer(), worldRoot); equipment.tick(worldRoot);
    }
  }

  private void stop(ServerStoppingEvent event) {
    DioramaWebBridge.stop();
    if (overlays != null) {
      overlays.stop(); status.stop(); skins.disable(); equipment.disable();
    }
    standaloneAssetRoot = null;
    worldRoot = null;
  }
}
