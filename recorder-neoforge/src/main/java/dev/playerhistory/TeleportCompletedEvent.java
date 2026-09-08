package dev.playerhistory;

import net.minecraft.server.level.ServerPlayer;
import net.neoforged.bus.api.Event;

public final class TeleportCompletedEvent extends Event {
  private final ServerPlayer player;
  private final double x, y, z;
  private final String world;

  public TeleportCompletedEvent(ServerPlayer player, double x, double y, double z, String world) {
    this.player = player;
    this.x = x;
    this.y = y;
    this.z = z;
    this.world = world;
  }

  public double x() {
    return x;
  }

  public double y() {
    return y;
  }

  public double z() {
    return z;
  }

  public String world() {
    return world;
  }

  public ServerPlayer player() {
    return player;
  }
}
