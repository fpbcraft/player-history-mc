package dev.fpbcraft.motd;

import java.io.IOException;
import java.time.ZoneId;
import java.time.DateTimeException;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.storage.LevelResource;
import net.neoforged.fml.ModContainer;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.config.ModConfig;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.neoforged.neoforge.event.server.ServerStartedEvent;
import net.neoforged.neoforge.event.server.ServerStoppingEvent;
import net.neoforged.neoforge.event.tick.ServerTickEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@Mod("fpbmotd")
public final class FpbMotdMod {
  private static final Logger LOG = LoggerFactory.getLogger("FPBCraftMOTD");
  private ActivityTracker activity;
  private MinecraftServer server;
  private String originalMotd;
  private long startedAt, nextRotationAt, nextSaveAt;
  private int messageIndex;
  private int tickCount;

  public FpbMotdMod(ModContainer container) {
    container.registerConfig(ModConfig.Type.COMMON, MotdConfig.SPEC);
    var events = NeoForge.EVENT_BUS;
    events.addListener(this::started);
    events.addListener(this::stopping);
    events.addListener(this::joined);
    events.addListener(this::left);
    events.addListener(this::tick);
  }

  private void started(ServerStartedEvent event) {
    server = event.getServer();
    originalMotd = server.getMotd();
    startedAt = System.currentTimeMillis();
    nextSaveAt = startedAt + 60_000;
    activity = new ActivityTracker(
        server.getWorldPath(LevelResource.ROOT).resolve("fpb-motd").resolve("activity.json"),
        startedAt);
    try {
      activity.load();
    } catch (IOException failure) {
      LOG.error("Cannot read MOTD activity history; original data will not be overwritten on startup", failure);
      // Preserve the damaged file until an administrator can investigate it.
      activity = null;
    }
    if (activity != null) refresh(startedAt, true);
  }

  private void joined(PlayerEvent.PlayerLoggedInEvent event) {
    if (activity == null || !(event.getEntity() instanceof ServerPlayer player)) return;
    long now = System.currentTimeMillis();
    activity.join(player.getUUID().toString(), player.getGameProfile().getName(), now, zone());
    refresh(now, false);
  }

  private void left(PlayerEvent.PlayerLoggedOutEvent event) {
    if (activity == null || !(event.getEntity() instanceof ServerPlayer player)) return;
    long now = System.currentTimeMillis();
    activity.leave(player.getUUID().toString(), now, zone());
    refresh(now, false);
  }

  private void tick(ServerTickEvent.Post event) {
    if (activity == null || server == null || event.getServer() != server) return;
    if (++tickCount % 20 != 0) return;
    long now = System.currentTimeMillis();
    activity.advance(now, zone());
    if (now >= nextRotationAt) refresh(now, true);
    if (now >= nextSaveAt) {
      persist(now);
      nextSaveAt = now + 60_000;
    }
  }

  private void stopping(ServerStoppingEvent event) {
    if (server == null) return;
    if (activity != null) {
      long now = System.currentTimeMillis();
      activity.stop(now, zone());
      persist(now);
    }
    server.setMotd(originalMotd);
    server.invalidateStatus();
    activity = null;
    server = null;
  }

  private void persist(long now) {
    if (activity == null) return;
    try {
      activity.save(now, zone());
    } catch (IOException failure) {
      LOG.error("Cannot write MOTD activity state", failure);
    }
  }

  private void refresh(long now, boolean rotate) {
    if (server == null || activity == null) return;
    if (!MotdConfig.ENABLED.get()) {
      server.setMotd(originalMotd);
      server.invalidateStatus();
      nextRotationAt = now + 1000L * MotdConfig.ROTATION_SECONDS.get();
      return;
    }
    var snapshot = activity.snapshot(now, zone(), startedAt);
    long worldDay = server.overworld().getDayTime() / 24000L + 1;
    String description = MotdRenderer.render(
        MotdConfig.HEADER.get(),
        MotdConfig.MESSAGES.get(),
        messageIndex,
        snapshot,
        now,
        worldDay,
        MotdConfig.PACK_VERSION.get());
    server.setMotd(description);
    server.invalidateStatus();
    if (rotate) messageIndex++;
    nextRotationAt = now + 1000L * MotdConfig.ROTATION_SECONDS.get();
  }

  private ZoneId zone() {
    try {
      return ZoneId.of(MotdConfig.TIMEZONE.get());
    } catch (DateTimeException invalid) {
      return ZoneId.of("UTC");
    }
  }
}
