package dev.playerhistory.bluemap;

import dev.playerhistory.core.LogSink;

import java.util.List;
import net.minecraft.server.MinecraftServer;
import net.neoforged.fml.ModList;

interface ClaimsOverlaySource {
  record ClaimCell(
      String dimension,
      int x,
      int z,
      String owner,
      int color,
      boolean forceLoadMarked) {}

  void start(MinecraftServer server);
  void stop();
  List<ClaimCell> snapshot();

  static ClaimsOverlaySource create(LogSink log) {
    if (!ModList.get().isLoaded("openpartiesandclaims")) return empty();
    try {
      return (ClaimsOverlaySource)
          Class.forName("dev.playerhistory.bluemap.OpacClaimsSource")
              .getConstructor(LogSink.class)
              .newInstance(log);
    } catch (ReflectiveOperationException error) {
      log.warn("OpenPAC is installed, but its overlay bridge could not be loaded: " + error);
      return empty();
    }
  }

  static ClaimsOverlaySource empty() {
    return new ClaimsOverlaySource() {
      public void start(MinecraftServer server) {}
      public void stop() {}
      public List<ClaimCell> snapshot() { return List.of(); }
    };
  }
}
