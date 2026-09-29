package dev.playerhistory.bluemap.mixin;

import dev.playerhistory.bluemap.TickLoadTracker;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.chunk.LevelChunk;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(ServerLevel.class)
public abstract class ChunkTickProfilerMixin {
  @Unique
  private final ThreadLocal<Long> playerhistory$chunkTickStarted =
      ThreadLocal.withInitial(() -> 0L);

  @Inject(method = "tickChunk", at = @At("HEAD"))
  private void playerhistory$beforeChunkTick(LevelChunk chunk, int randomTickSpeed, CallbackInfo ci) {
    playerhistory$chunkTickStarted.set(TickLoadTracker.sampling() ? System.nanoTime() : 0L);
  }

  @Inject(method = "tickChunk", at = @At("RETURN"))
  private void playerhistory$afterChunkTick(LevelChunk chunk, int randomTickSpeed, CallbackInfo ci) {
    long started = playerhistory$chunkTickStarted.get();
    playerhistory$chunkTickStarted.remove();
    if (started == 0L) return;
    long elapsed = System.nanoTime() - started;
    TickLoadTracker.recordChunk((ServerLevel) (Object) this, chunk.getPos(), elapsed);
  }
}
