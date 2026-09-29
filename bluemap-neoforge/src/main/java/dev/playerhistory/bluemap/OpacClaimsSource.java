package dev.playerhistory.bluemap;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import xaero.pac.common.claims.player.api.IPlayerChunkClaimAPI;
import xaero.pac.common.claims.player.api.IPlayerClaimPosListAPI;
import xaero.pac.common.claims.tracker.api.IClaimsManagerListenerAPI;
import xaero.pac.common.server.api.OpenPACServerAPI;

public final class OpacClaimsSource implements ClaimsOverlaySource, IClaimsManagerListenerAPI {
  private final Consumer<String> log;
  private final AtomicBoolean dirty = new AtomicBoolean(true);
  private volatile MinecraftServer server;
  private volatile List<ClaimCell> cells = List.of();

  public OpacClaimsSource(Consumer<String> log) {
    this.log = Objects.requireNonNull(log);
  }

  @Override
  public void start(MinecraftServer server) {
    this.server = server;
    dirty.set(true);
    try {
      OpenPACServerAPI.get(server).getServerClaimsManager().getTracker().register(this);
      log.accept("OpenPAC map-overlay source enabled.");
    } catch (RuntimeException error) {
      log.accept("Could not register OpenPAC map-overlay listener: " + error);
    }
  }

  @Override
  public void stop() {
    server = null;
    cells = List.of();
    dirty.set(true);
  }

  @Override
  public List<ClaimCell> snapshot() {
    if (dirty.compareAndSet(true, false)) reload();
    return cells;
  }

  private void reload() {
    MinecraftServer current = server;
    if (current == null) {
      cells = List.of();
      return;
    }

    try {
      var next = new ArrayList<ClaimCell>();
      OpenPACServerAPI.get(current)
          .getServerClaimsManager()
          .getPlayerInfoStream()
          .forEach(
              info -> {
                String owner = info.getClaimsName();
                if (owner == null || owner.isBlank()) owner = info.getPlayerUsername();
                final String label = owner == null || owner.isBlank() ? info.getPlayerId().toString() : owner;
                final int color = info.getClaimsColor();
                info.getStream()
                    .forEach(
                        entry -> {
                          String dimension = entry.getKey().toString();
                          entry.getValue().getStream()
                              .flatMap(IPlayerClaimPosListAPI::getStream)
                              .forEach(pos -> next.add(new ClaimCell(dimension, pos.x, pos.z, label, color)));
                        });
              });
      cells = List.copyOf(next);
    } catch (RuntimeException error) {
      dirty.set(true);
      log.accept("Could not refresh OpenPAC overlay data: " + error);
    }
  }

  @Override
  public void onWholeRegionChange(ResourceLocation dimension, int regionX, int regionZ) {
    dirty.set(true);
  }

  @Override
  public void onChunkChange(
      ResourceLocation dimension, int chunkX, int chunkZ, IPlayerChunkClaimAPI claim) {
    dirty.set(true);
  }

  @Override
  public void onDimensionChange(ResourceLocation dimension) {
    dirty.set(true);
  }
}
