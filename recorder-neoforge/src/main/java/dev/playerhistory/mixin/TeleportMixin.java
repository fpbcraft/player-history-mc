package dev.playerhistory.mixin;

import dev.playerhistory.TeleportCompletedEvent;
import java.util.Set;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.ServerGamePacketListenerImpl;
import net.minecraft.world.entity.RelativeMovement;
import net.neoforged.neoforge.common.NeoForge;
import org.spongepowered.asm.mixin.*;
import org.spongepowered.asm.mixin.injection.*;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Observes completed vanilla connection teleports, including commands and pearls. */
@Mixin(ServerGamePacketListenerImpl.class)
public abstract class TeleportMixin {
  @Shadow public ServerPlayer player;
  @Unique private double history$x, history$y, history$z;
  @Unique private String history$world;

  @Inject(method = "teleport(DDDFFLjava/util/Set;)V", at = @At("HEAD"))
  private void history$before(
      double x,
      double y,
      double z,
      float yaw,
      float pitch,
      Set<RelativeMovement> relative,
      CallbackInfo ci) {
    history$world = player.level().dimension().location().toString();
    history$x = player.getX();
    history$y = player.getY();
    history$z = player.getZ();
  }

  @Inject(method = "teleport(DDDFFLjava/util/Set;)V", at = @At("RETURN"))
  private void history$after(
      double x,
      double y,
      double z,
      float yaw,
      float pitch,
      Set<RelativeMovement> relative,
      CallbackInfo ci) {
    if (history$x != player.getX() || history$y != player.getY() || history$z != player.getZ())
      NeoForge.EVENT_BUS.post(
          new TeleportCompletedEvent(player, history$x, history$y, history$z, history$world));
  }
}
