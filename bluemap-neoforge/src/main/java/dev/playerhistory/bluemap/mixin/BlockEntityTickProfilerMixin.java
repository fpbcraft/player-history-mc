package dev.playerhistory.bluemap.mixin;

import dev.playerhistory.bluemap.TickLoadTracker;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.entity.TickingBlockEntity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

@Mixin(Level.class)
public abstract class BlockEntityTickProfilerMixin {
  @Redirect(
      method = "tickBlockEntities",
      at =
          @At(
              value = "INVOKE",
              target = "Lnet/minecraft/world/level/block/entity/TickingBlockEntity;tick()V"))
  private void playerhistory$measureBlockEntityTick(TickingBlockEntity ticker) {
    Level level = (Level) (Object) this;
    if (!(level instanceof ServerLevel serverLevel) || !TickLoadTracker.sampling()) {
      ticker.tick();
      return;
    }

    // Some modded/removed tickers can expose a null position, and a ticker may
    // detach itself during tick(). Capture the position before ticking and skip
    // profiling unbound tickers rather than letting diagnostics affect gameplay.
    var pos = ticker.getPos();
    if (pos == null) {
      ticker.tick();
      return;
    }

    long started = System.nanoTime();
    try {
      ticker.tick();
    } finally {
      TickLoadTracker.recordBlockEntity(serverLevel, pos, System.nanoTime() - started);
    }
  }
}
