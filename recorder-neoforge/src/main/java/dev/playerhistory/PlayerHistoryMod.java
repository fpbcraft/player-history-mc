package dev.playerhistory;

import dev.playerhistory.config.HistoryConfig;
import dev.playerhistory.core.*;
import dev.playerhistory.object.*;
import dev.playerhistory.state.TelemetryRecorder;
import java.util.*;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.storage.LevelResource;
import net.neoforged.fml.ModContainer;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.config.ModConfig;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import net.neoforged.neoforge.event.entity.living.LivingDeathEvent;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.neoforged.neoforge.event.server.*;
import net.neoforged.neoforge.event.tick.ServerTickEvent;
import org.slf4j.LoggerFactory;

@Mod("playerhistory")
public final class PlayerHistoryMod {
  private HistoryStore store;
  private ObjectHistoryRecorder objectHistory;
  private dev.playerhistory.web.WebChat webChat;
  private final TelemetryRecorder telemetry;
  private boolean recordingMovement = true;
  private Registry registry;
  private Sampler sampler;
  private long nextSample, lastTime;
  private final Map<UUID, Point> visible = new HashMap<>();

  public PlayerHistoryMod(ModContainer container) {
    container.registerConfig(ModConfig.Type.COMMON, HistoryConfig.SPEC);
    telemetry = new TelemetryRecorder(() -> store, () -> registry, this::allowed, this::now);
    var bus = NeoForge.EVENT_BUS;
    bus.addListener(this::start);
    bus.addListener(net.neoforged.bus.api.EventPriority.LOWEST, false, this::chat);
    bus.addListener(this::stop);
    bus.addListener(this::tick);
    bus.addListener(this::commands);
    bus.addListener(this::join);
    bus.addListener(this::quit);
    bus.addListener(this::dimension);
    bus.addListener(this::respawn);
    bus.addListener(net.neoforged.bus.api.EventPriority.LOWEST, false, this::death);
    bus.addListener(this::teleport);
  }

  private long now() {
    return lastTime = Math.max(lastTime, System.currentTimeMillis());
  }

  private void start(ServerStartedEvent e) {
    if (!HistoryConfig.ENABLED.get()) return;
    try {
      var root = e.getServer().getWorldPath(LevelResource.ROOT).resolve("player-history");
      registry = new Registry(root.resolve("registry.json"));
      sampler = new Sampler(HistoryConfig.MOVEMENT.get(), HistoryConfig.KEYFRAME.get() * 1000L);
      store =
          new HistoryStore(
              root,
              registry,
              new HistoryStore.Options(
                  HistoryConfig.CHUNK.get() * 60_000L,
                  HistoryConfig.RETENTION.get(),
                  HistoryConfig.QUEUE.get(),
                  HistoryConfig.CELL.get(),
                  HistoryConfig.HEATMAP.get()),
              s -> LoggerFactory.getLogger("PlayerHistory").info(s));
      store.capabilities(HistoryConfig.capabilities());
      if (HistoryConfig.OBJECTS.get()) {
        objectHistory =
            new ObjectHistoryRecorder(
                root.resolve("objects"),
                new ObjectHistoryRecorder.Options(
                    HistoryConfig.CHUNK.get() * 60_000L,
                    HistoryConfig.RETENTION.get(),
                    HistoryConfig.QUEUE.get(),
                    HistoryConfig.OBJECT_MOVEMENT.get(),
                    HistoryConfig.OBJECT_ROTATION.get(),
                    HistoryConfig.OBJECT_KEYFRAME.get() * 1000L),
                message -> LoggerFactory.getLogger("PlayerHistoryObjects").info(message));
        ObjectHistoryApi.install(objectHistory);
      }
      if (HistoryConfig.PUBLISH.get()) {
        var target = java.nio.file.Path.of(HistoryConfig.PUBLIC_DIRECTORY.get());
        var dataset =
            target.isAbsolute()
                ? target
                : e.getServer().getWorldPath(LevelResource.ROOT).resolve(target);
        store.publishTo(dataset);
        if (objectHistory != null) objectHistory.publishTo(dataset);
      }
      if (HistoryConfig.WEBCHAT.get()) {
        webChat = new dev.playerhistory.web.WebChat(root.resolve("webchat-sessions.json"), HistoryConfig.WEBCHAT_BIND.get(), HistoryConfig.WEBCHAT_PORT.get(), (session, message) -> {
          var result = new java.util.concurrent.CompletableFuture<Boolean>();
          e.getServer().execute(() -> {
          if (result.isCancelled() || webChat == null || store == null) { result.complete(false); return; }
          UUID uuid = UUID.fromString(session.uuid());
          if (HistoryConfig.EXCLUDED_PLAYERS.get().contains(session.uuid())) { result.complete(false); return; }
          var profile = new com.mojang.authlib.GameProfile(uuid, session.name());
          if (e.getServer().getPlayerList().getBans().isBanned(profile)) { result.complete(false); return; }
          e.getServer().getPlayerList().broadcastSystemMessage(Component.literal("[Web] <" + session.name() + "> " + message), false);
          webChat.receive(session.name(), message, true);
          ServerPlayer player = e.getServer().getPlayerList().getPlayer(uuid);
          if (player != null && allowed(player) && HistoryConfig.tracks("chat"))
            store.offer(List.of(), List.of(new HistoryEvent(point(player, 0), "CHAT", JsonFiles.GSON.toJson(Map.of("message", message, "source", "web")))));
          result.complete(true);
          });
          try { return result.get(5, java.util.concurrent.TimeUnit.SECONDS); }
          catch (Exception failure) { result.cancel(false); return false; }
        });
      }
    } catch (Exception failure) {
      LoggerFactory.getLogger("PlayerHistory").error("Cannot start history recorder", failure);
    }
  }

  private void chat(net.neoforged.neoforge.event.ServerChatEvent e) {
    if (webChat != null && allowed(e.getPlayer()) && HistoryConfig.tracks("chat"))
      webChat.receive(e.getPlayer().getGameProfile().getName(), e.getMessage().getString(), false);
  }

  private void stop(ServerStoppingEvent e) {
    if (webChat != null) { webChat.close(); webChat = null; }
    if (objectHistory != null) {
      ObjectHistoryApi.clear(objectHistory);
      objectHistory.close();
      objectHistory = null;
    }
    if (store != null) {
      if (HistoryConfig.tracks("movement"))
        for (var p : visible.values())
          store.offer(List.of(p.with(now(), Point.OFFLINE)), List.of());
      telemetry.close();
      store.close();
      store = null;
    }
    visible.clear();
  }

  private boolean allowed(ServerPlayer p) {
    return HistoryConfig.ENABLED.get()
        && VisibilityPolicy.allow(
            HistoryConfig.EXCLUDED_PLAYERS.get().contains(p.getUUID().toString())
                || HistoryConfig.EXCLUDED_WORLDS
                    .get()
                    .contains(p.level().dimension().location().toString()),
            HistoryConfig.RESPECT_HIDDEN.get(),
            p.isInvisible(),
            VisibilityPolicy.Provider.ABSENT);
  }

  private Point point(ServerPlayer p, int flags) {
    return Point.at(
        registry.player(p.getUUID(), p.getGameProfile().getName()),
        now(),
        registry.world(p.level().dimension().location().toString()),
        p.getX(),
        p.getY(),
        p.getZ(),
        flags);
  }

  private void tick(ServerTickEvent.Post e) {
    if (store == null || now() < nextSample) return;
    nextSample = now() + HistoryConfig.SAMPLE.get();
    store.capabilities(HistoryConfig.capabilities());
    store.retentionDays(HistoryConfig.RETENTION.get());
    if (objectHistory != null) objectHistory.retentionDays(HistoryConfig.RETENTION.get());
    if (recordingMovement && !HistoryConfig.tracks("movement")) {
      for (var point : visible.values())
        store.offer(List.of(point.with(now(), Point.OFFLINE | Point.BREAK)), List.of());
    }
    for (var p : e.getServer().getPlayerList().getPlayers()) {
      telemetry.sample(p);
      if (!allowed(p) || !p.isAlive()) {
        hide(p);
        continue;
      }
      if (!visible.containsKey(p.getUUID())) {
        event(p, "JOIN", Point.BREAK, HistoryConfig.tracks("sessions"));
        continue;
      }
      var snapshot = point(p, 0);
      if (HistoryConfig.tracks("movement")) {
        if (!recordingMovement) sampler.reset(snapshot.player());
        sampler.sample(snapshot, q -> store.offer(List.of(q), List.of()));
      }
      visible.put(p.getUUID(), snapshot);
    }
    recordingMovement = HistoryConfig.tracks("movement");
  }

  private void hide(ServerPlayer p) {
    telemetry.end(p);
    Point old = visible.remove(p.getUUID());
    if (old != null) {
      var end = old.with(now(), Point.OFFLINE);
      if (HistoryConfig.tracks("movement")) store.offer(List.of(end), List.of());
      sampler.reset(old.player());
    }
  }

  private void event(ServerPlayer p, String type, int flags, boolean include) {
    event(p, type, flags, include, null);
  }

  private void event(
      ServerPlayer p, String type, int flags, boolean include, String message) {
    if (store == null) return;
    if (!allowed(p)) {
      hide(p);
      return;
    }
    Point current = point(p, flags), old = visible.get(p.getUUID());
    var ps = new ArrayList<Point>();
    if (old != null && (flags & Point.BREAK) != 0) ps.add(old.with(current.time(), Point.OFFLINE));
    ps.add(current);
    var payload = new LinkedHashMap<String, Object>();
    if (old != null) {
      payload.put("from", old);
      payload.put("to", current);
    }
    if (message != null && !message.isBlank())
      payload.put("message", message.substring(0, Math.min(512, message.length())));
    String payloadJson = JsonFiles.GSON.toJson(payload);
    if ((flags & Point.BREAK) != 0) telemetry.boundary(p);
    if ((flags & Point.OFFLINE) != 0) telemetry.end(p);
    store.offer(
        HistoryConfig.tracks("movement") ? ps : List.of(),
        include ? List.of(new HistoryEvent(current, type, payloadJson)) : List.of());
    sampler.reset(current.player());
    if (current.online()) visible.put(p.getUUID(), current);
    else visible.remove(p.getUUID());
  }

  private void join(PlayerEvent.PlayerLoggedInEvent e) {
    if (e.getEntity() instanceof ServerPlayer p)
      event(p, "JOIN", Point.BREAK, HistoryConfig.tracks("sessions"));
  }

  private void quit(PlayerEvent.PlayerLoggedOutEvent e) {
    if (e.getEntity() instanceof ServerPlayer p)
      event(p, "QUIT", Point.OFFLINE, HistoryConfig.tracks("sessions"));
  }

  private void dimension(PlayerEvent.PlayerChangedDimensionEvent e) {
    if (e.getEntity() instanceof ServerPlayer p)
      event(p, "DIMENSION_CHANGE", Point.BREAK, HistoryConfig.DIMENSIONS.get());
  }

  private void respawn(PlayerEvent.PlayerRespawnEvent e) {
    if (e.getEntity() instanceof ServerPlayer p)
      event(p, "RESPAWN", Point.BREAK, HistoryConfig.tracks("sessions"));
  }

  private void death(LivingDeathEvent e) {
    if (e.getEntity() instanceof ServerPlayer p)
      event(
          p,
          "DEATH",
          Point.OFFLINE,
          HistoryConfig.DEATHS.get(),
          p.getCombatTracker().getDeathMessage().getString());
  }

  private void teleport(TeleportCompletedEvent e) {
    var p = e.player();
    if (store == null || !visible.containsKey(p.getUUID())) return;
    Point old = visible.get(p.getUUID());
    visible.put(
        p.getUUID(),
        Point.at(old.player(), now(), registry.world(e.world()), e.x(), e.y(), e.z(), 0));
    event(p, "TELEPORT", Point.BREAK, HistoryConfig.TELEPORTS.get());
  }

  private void commands(RegisterCommandsEvent e) {
    e.getDispatcher().register(Commands.literal("webchat")
      .then(Commands.literal("link").then(Commands.argument("code", com.mojang.brigadier.arguments.StringArgumentType.word()).executes(c -> {
        var player = c.getSource().getPlayerOrException();
        try {
          boolean linked = webChat != null && webChat.auth.link(com.mojang.brigadier.arguments.StringArgumentType.getString(c, "code"), player.getUUID(), player.getGameProfile().getName(), now());
          c.getSource().sendSuccess(() -> Component.literal(linked ? "Browser linked. Only approve codes from your own browser. Use /webchat logout to revoke all browsers." : "Invalid or expired code. Request a new code on the map."), false);
          return linked ? 1 : 0;
        } catch (Exception failure) { c.getSource().sendFailure(Component.literal("Unable to save browser link.")); return 0; }
      })))
      .then(Commands.literal("logout").executes(c -> {
        var player = c.getSource().getPlayerOrException();
        try { if (webChat != null) webChat.auth.revoke(player.getUUID()); }
        catch (Exception failure) { c.getSource().sendFailure(Component.literal("Unable to save logout.")); return 0; }
        c.getSource().sendSuccess(() -> Component.literal("All linked browsers logged out."), false); return 1;
      })));

    e.getDispatcher()
        .register(
            Commands.literal("playerhistory")
                .requires(s -> s.hasPermission(2))
                .then(
                    Commands.literal("stats")
                        .executes(
                            c -> {
                              c.getSource()
                                  .sendSuccess(
                                      () ->
                                          Component.literal(
                                              store == null
                                                  ? "History disabled"
                                                  : store.stats()
                                                      + " stationarySkipped="
                                                      + sampler.skipped
                                                      + (objectHistory == null
                                                          ? ""
                                                          : " " + objectHistory.stats())),
                                      false);
                              return 1;
                            })));
  }
}
