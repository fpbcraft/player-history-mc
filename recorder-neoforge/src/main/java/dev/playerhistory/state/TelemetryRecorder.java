package dev.playerhistory.state;

import dev.playerhistory.config.HistoryConfig;
import dev.playerhistory.core.*;
import java.util.*;
import java.util.function.*;
import net.minecraft.core.component.DataComponents;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.item.ItemStack;
import net.neoforged.bus.api.EventPriority;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.entity.item.ItemTossEvent;
import net.neoforged.neoforge.event.entity.living.*;
import net.neoforged.neoforge.event.entity.player.*;
import net.neoforged.neoforge.event.level.BlockEvent;

/** Server-thread immutable snapshots; persistence is delegated to the bounded writer queue. */
public final class TelemetryRecorder {
  private final Supplier<HistoryStore> store;
  private final Supplier<Registry> registry;
  private final Predicate<ServerPlayer> allowed;
  private final LongSupplier now;
  private StateTracker tracker = new StateTracker();
  private final Map<UUID, Integer> online = new HashMap<>();
  private final CuriosEquipmentReader curios = new CuriosEquipmentReader();

  public TelemetryRecorder(
      Supplier<HistoryStore> store,
      Supplier<Registry> registry,
      Predicate<ServerPlayer> allowed,
      LongSupplier now) {
    this.store = store;
    this.registry = registry;
    this.allowed = allowed;
    this.now = now;
    var bus = NeoForge.EVENT_BUS;
    bus.addListener(EventPriority.LOWEST, false, this::blockBreak);
    bus.addListener(EventPriority.LOWEST, false, this::blockPlace);
    bus.addListener(this::container);
    bus.addListener(this::damage);
    bus.addListener(EventPriority.LOWEST, false, this::kill);
    bus.addListener(this::advancement);
    bus.addListener(this::craft);
    bus.addListener(this::smelt);
    bus.addListener(this::pickup);
    bus.addListener(EventPriority.LOWEST, false, this::drop);
    bus.addListener(this::enchant);
    bus.addListener(this::trade);
    bus.addListener(EventPriority.LOWEST, false, this::chat);
  }

  private void chat(net.neoforged.neoforge.event.ServerChatEvent event) {
    if (!eligible(event.getPlayer(), "chat")) return;
    String message = event.getMessage().getString();
    emit(
        event.getPlayer(),
        "chat",
        "CHAT",
        Map.of("message", message.substring(0, Math.min(512, message.length()))));
  }

  public void clear() {
    tracker = new StateTracker();
    online.clear();
  }

  public void boundary(ServerPlayer p) {
    if (registry.get() != null) tracker.reset(id(p));
  }

  private int id(ServerPlayer p) {
    return registry.get().player(p.getUUID(), p.getGameProfile().getName());
  }

  public void end(ServerPlayer p) {
    if (store.get() == null) return;
    Integer id = online.remove(p.getUUID());
    if (id != null)
      store.get().offer(List.of(), List.of(), List.of(tracker.end(id, now.getAsLong())));
  }

  public void close() {
    if (store.get() != null)
      for (int id : online.values())
        store.get().offer(List.of(), List.of(), List.of(tracker.end(id, now.getAsLong())));
    clear();
  }

  private boolean eligible(ServerPlayer p, String key) {
    return store.get() != null && on(key) && allowed.test(p);
  }

  private boolean on(String key) {
    return HistoryConfig.tracks(key);
  }

  public Map<String, Object> item(ItemStack stack) {
    if (stack.isEmpty()) return Map.of("item", 0, "count", 0);
    var value = new LinkedHashMap<String, Object>();
    value.put(
        "item", registry.get().item(BuiltInRegistries.ITEM.getKey(stack.getItem()).toString()));
    value.put("count", stack.getCount());
    var dyedColor = stack.get(DataComponents.DYED_COLOR);
    if (dyedColor != null) value.put("color", dyedColor.rgb() & 0xFFFFFF);
    if (on("item-damage")) value.put("damage", stack.getDamageValue());
    if (on("item-custom-name") && stack.has(DataComponents.CUSTOM_NAME)) {
      String name = stack.getHoverName().getString();
      value.put("name", name.substring(0, Math.min(256, name.length())));
    }
    if (on("item-enchantments")) {
      var ench = new TreeMap<String, Object>();
      for (var entry : stack.getEnchantments().entrySet()) {
        if (ench.size() >= 32) break;
        ench.put(
            entry.getKey().unwrapKey().map(k -> k.location().toString()).orElse("unknown"),
            entry.getIntValue());
      }
      if (!ench.isEmpty()) value.put("enchantments", ench);
    }
    return Collections.unmodifiableMap(value);
  }

  public void sample(ServerPlayer p) {
    if (store.get() == null) return;
    if (!allowed.test(p) || !p.isAlive()) {
      end(p);
      return;
    }
    int id = id(p);
    long time = now.getAsLong();
    var values = new LinkedHashMap<String, Object>();
    if (on("health")) {
      values.put("health", p.getHealth());
      values.put("maxHealth", p.getMaxHealth());
      values.put("absorption", p.getAbsorptionAmount());
    }
    if (on("food")) {
      values.put("food", p.getFoodData().getFoodLevel());
      if (on("saturation")) values.put("saturation", p.getFoodData().getSaturationLevel());
    }
    if (on("xp")) {
      values.put("xpTotal", p.totalExperience);
      values.put("xpLevel", p.experienceLevel);
      values.put("xpProgress", p.experienceProgress);
    }
    if (on("game-mode")) values.put("gameMode", p.gameMode.getGameModeForPlayer().getName());
    if (on("orientation")) {
      values.put("yaw", Math.round(p.getYRot() * 2.0f) / 2.0f);
      values.put("headYaw", Math.round(p.getYHeadRot() * 2.0f) / 2.0f);
      values.put("bodyYaw", Math.round(p.yBodyRot * 2.0f) / 2.0f);
      values.put("pitch", Math.round(p.getXRot() * 2.0f) / 2.0f);
    }
    if (on("posture")) {
      values.put("sprinting", p.isSprinting());
      values.put("sneaking", p.isShiftKeyDown());
      values.put("swimming", p.isSwimming());
      values.put("elytra", p.isFallFlying());
      values.put("sleeping", p.isSleeping());
      values.put("onGround", p.onGround());
      values.put("onFire", p.isOnFire());
      values.put("frozen", p.getTicksFrozen());
    }
    if (on("effects")) {
      var effects = new TreeMap<String, Object>();
      for (var effect : p.getActiveEffects())
        effects.put(
            BuiltInRegistries.MOB_EFFECT.getKey(effect.getEffect().value()).toString(),
            Map.of("amplifier", effect.getAmplifier(), "ambient", effect.isAmbient()));
      values.put("effects", effects);
    }
    if (on("held-item")) {
      values.put("selectedSlot", p.getInventory().selected);
      values.put("heldItem", item(p.getMainHandItem()));
    }
    if (on("equipment"))
      for (EquipmentSlot slot :
          List.of(
              EquipmentSlot.MAINHAND,
              EquipmentSlot.OFFHAND,
              EquipmentSlot.HEAD,
              EquipmentSlot.CHEST,
              EquipmentSlot.LEGS,
              EquipmentSlot.FEET))
        values.put("equipment:" + slot.getName(), item(p.getItemBySlot(slot)));
    if (on("curios"))
      curios.visible(p).forEach((key, stack) -> values.put(key, item(stack)));
    if (on("inventory"))
      for (int slot = 0; slot < p.getInventory().getContainerSize(); slot++)
        values.put("slot:" + slot, item(p.getInventory().getItem(slot)));
    var record =
        tracker.update(
            id,
            time,
            HistoryConfig.CHUNK.get() * 60000L,
            HistoryConfig.CHECKPOINT.get() * 60000L,
            values);
    online.put(p.getUUID(), id);
    if (record != null && !store.get().offer(List.of(), List.of(), List.of(record)))
      tracker = new StateTracker();
  }

  private void emit(ServerPlayer p, String key, String type, Map<String, Object> payload) {
    if (!eligible(p, key)) return;
    String json = JsonFiles.GSON.toJson(payload);
    if (json.length() > 2048) json = "{\"detailsTruncated\":true}";
    Point point =
        Point.at(
            id(p),
            now.getAsLong(),
            registry.get().world(p.level().dimension().location().toString()),
            payload.get("x") instanceof Number x ? x.doubleValue() : p.getX(),
            payload.get("y") instanceof Number y ? y.doubleValue() : p.getY(),
            payload.get("z") instanceof Number z ? z.doubleValue() : p.getZ(),
            0);
    store.get().offer(List.of(), List.of(new HistoryEvent(point, type, json)));
  }

  private void blockBreak(BlockEvent.BreakEvent e) {
    if (e.getPlayer() instanceof ServerPlayer p)
      emit(
          p,
          "block-break",
          "BLOCK_BREAK",
          Map.of(
              "block",
              BuiltInRegistries.BLOCK.getKey(e.getState().getBlock()).toString(),
              "x",
              e.getPos().getX(),
              "y",
              e.getPos().getY(),
              "z",
              e.getPos().getZ()));
  }

  private void blockPlace(BlockEvent.EntityPlaceEvent e) {
    if (e.getEntity() instanceof ServerPlayer p)
      emit(
          p,
          "block-place",
          "BLOCK_PLACE",
          Map.of(
              "block",
              BuiltInRegistries.BLOCK.getKey(e.getPlacedBlock().getBlock()).toString(),
              "x",
              e.getPos().getX(),
              "y",
              e.getPos().getY(),
              "z",
              e.getPos().getZ()));
  }

  private void container(PlayerContainerEvent.Open e) {
    if (e.getEntity() instanceof ServerPlayer p) {
      String type;
      try {
        type = BuiltInRegistries.MENU.getKey(e.getContainer().getType()).toString();
      } catch (Exception ignored) {
        type = e.getContainer().getClass().getSimpleName();
      }
      emit(
          p,
          "container-open",
          "CONTAINER_OPEN",
          Map.of(
              "menuType", type, "positionKind", "player position; container position unavailable"));
    }
  }

  private void damage(LivingDamageEvent.Post e) {
    var data =
        Map.<String, Object>of(
            "amount",
            e.getNewDamage(),
            "healthAfter",
            e.getEntity().getHealth(),
            "source",
            e.getSource().getMsgId(),
            "targetType",
            BuiltInRegistries.ENTITY_TYPE.getKey(e.getEntity().getType()).toString());
    if (e.getEntity() instanceof ServerPlayer p) emit(p, "damage-taken", "DAMAGE_TAKEN", data);
    if (e.getSource().getEntity() instanceof ServerPlayer p)
      emit(p, "damage-dealt", "DAMAGE_DEALT", data);
  }

  private void kill(LivingDeathEvent e) {
    if (e.getSource().getEntity() instanceof ServerPlayer p) {
      boolean player = e.getEntity() instanceof ServerPlayer;
      emit(
          p,
          player ? "player-kills" : "mob-kills",
          player ? "PLAYER_KILL" : "MOB_KILL",
          Map.of(
              "targetType",
              BuiltInRegistries.ENTITY_TYPE.getKey(e.getEntity().getType()).toString()));
    }
  }

  private void advancement(AdvancementEvent.AdvancementEarnEvent e) {
    if (e.getEntity() instanceof ServerPlayer p)
      emit(
          p,
          "advancements",
          "ADVANCEMENT",
          Map.of("advancement", e.getAdvancement().id().toString()));
  }

  private void craft(PlayerEvent.ItemCraftedEvent e) {
    if (e.getEntity() instanceof ServerPlayer p && eligible(p, "crafting"))
      emit(p, "crafting", "CRAFT", item(e.getCrafting()));
  }

  private void smelt(PlayerEvent.ItemSmeltedEvent e) {
    if (e.getEntity() instanceof ServerPlayer p && eligible(p, "smelting"))
      emit(p, "smelting", "SMELT", item(e.getSmelting()));
  }

  private void pickup(ItemEntityPickupEvent.Post e) {
    if (e.getPlayer() instanceof ServerPlayer p && eligible(p, "item-pickup")) {
      var item = e.getOriginalStack().copy();
      item.setCount(Math.max(0, item.getCount() - e.getCurrentStack().getCount()));
      emit(p, "item-pickup", "ITEM_PICKUP", item(item));
    }
  }

  private void drop(ItemTossEvent e) {
    if (e.getPlayer() instanceof ServerPlayer p && eligible(p, "item-drop"))
      emit(p, "item-drop", "ITEM_DROP", item(e.getEntity().getItem()));
  }

  private void enchant(PlayerEnchantItemEvent e) {
    if (e.getEntity() instanceof ServerPlayer p && eligible(p, "enchanting"))
      emit(p, "enchanting", "ENCHANT", item(e.getEnchantedItem()));
  }

  private void trade(TradeWithVillagerEvent e) {
    if (e.getEntity() instanceof ServerPlayer p && eligible(p, "trading"))
      emit(p, "trading", "TRADE", item(e.getMerchantOffer().getResult()));
  }
}
