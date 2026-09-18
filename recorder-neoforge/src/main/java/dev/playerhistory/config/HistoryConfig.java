package dev.playerhistory.config;

import java.util.*;
import net.neoforged.neoforge.common.ModConfigSpec;

public final class HistoryConfig {
  public static final ModConfigSpec SPEC;
  public static final ModConfigSpec.BooleanValue WEBCHAT;
  public static final ModConfigSpec.ConfigValue<String> WEBCHAT_BIND;
  public static final ModConfigSpec.IntValue WEBCHAT_PORT;
  public static final ModConfigSpec.BooleanValue ENABLED,
      RESPECT_HIDDEN,
      HEATMAP,
      DEATHS,
      TELEPORTS,
      DIMENSIONS,
      OBJECTS,
      PUBLISH;
  public static final ModConfigSpec.ConfigValue<String> PUBLIC_DIRECTORY;
  public static final ModConfigSpec.IntValue SAMPLE, KEYFRAME, CHUNK, RETENTION, QUEUE, CELL,
      OBJECT_KEYFRAME;
  public static final ModConfigSpec.DoubleValue MOVEMENT, OBJECT_MOVEMENT, OBJECT_ROTATION;
  public static final ModConfigSpec.ConfigValue<List<? extends String>> EXCLUDED_PLAYERS,
      EXCLUDED_WORLDS;

  public static final Map<String, ModConfigSpec.BooleanValue> TRACKERS = new LinkedHashMap<>();
  public static final ModConfigSpec.IntValue CHECKPOINT;

  public static boolean tracks(String name) {
    return TRACKERS.get(name).get();
  }

  public static Map<String, Boolean> capabilities() {
    var result = new TreeMap<String, Boolean>();
    TRACKERS.forEach((key, value) -> result.put(key, value.get()));
    result.put("heatmap", HEATMAP.get());
    result.put("activity", true);
    result.put("events", true);
    result.put("deaths", DEATHS.get());
    result.put("teleports", TELEPORTS.get());
    result.put("dimension-changes", DIMENSIONS.get());
    result.put("objects", OBJECTS.get());
    return result;
  }

  static {
    var b = new ModConfigSpec.Builder();
    ENABLED = b.define("enabled", true);
    SAMPLE = b.defineInRange("sample-interval-ms", 500, 50, 60_000);
    MOVEMENT = b.defineInRange("minimum-movement-distance", 0.25, 0.03125, 32);
    KEYFRAME = b.defineInRange("forced-keyframe-interval-seconds", 30, 1, 300);
    CHUNK = b.defineInRange("chunk-duration-minutes", 5, 1, 60);
    RETENTION =
        b.comment(
                "-1 unlimited; 0 retain current UTC day; positive values retain that many days plus"
                    + " current UTC day")
            .defineInRange("retention-days", 180, -1, 36500);
    QUEUE = b.defineInRange("queue-capacity", 8192, 64, 1_000_000);
    CELL = b.defineInRange("heatmap-cell-size", 8, 1, 256);
    HEATMAP = b.define("heatmap-enabled", true);
    RESPECT_HIDDEN = b.define("respect-hidden-players", true);
    DEATHS = b.define("track-deaths", true);
    TELEPORTS = b.define("track-teleports", true);
    DIMENSIONS = b.define("track-dimension-changes", true);
    OBJECTS = b.define("objects.enabled", true);
    OBJECT_MOVEMENT = b.defineInRange("objects.minimum-movement-distance", 0.25, 0.0, 32.0);
    OBJECT_ROTATION = b.defineInRange("objects.minimum-rotation-degrees", 1.0, 0.0, 180.0);
    OBJECT_KEYFRAME = b.defineInRange("objects.forced-keyframe-interval-seconds", 30, 1, 300);
    EXCLUDED_PLAYERS =
        b.defineListAllowEmpty("excluded-players", List.of(), () -> "", v -> v instanceof String);
    EXCLUDED_WORLDS =
        b.defineListAllowEmpty("excluded-worlds", List.of(), () -> "", v -> v instanceof String);
    PUBLISH = b.define("publishing.enabled", true);
    PUBLIC_DIRECTORY = b.define("publishing.public-directory", "player-history/public");
    for (String name :
        List.of(
            "movement",
            "sessions",
            "health",
            "food",
            "xp",
            "game-mode",
            "effects",
            "held-item",
            "equipment",
            "block-break",
            "block-place",
            "container-open",
            "damage-taken",
            "damage-dealt",
            "mob-kills",
            "player-kills",
            "advancements",
            "crafting",
            "smelting",
            "enchanting",
            "trading",
            "item-pickup",
            "item-drop", "chat")) TRACKERS.put(name, b.define("tracking." + name, true));
    for (String name : List.of("inventory", "saturation", "posture"))
      TRACKERS.put(name, b.define("tracking." + name, false));
    for (String name : List.of("item-damage", "item-enchantments", "item-custom-name"))
      TRACKERS.put(name, b.define("tracking." + name, true));
    CHECKPOINT = b.defineInRange("state.checkpoint-interval-minutes", 10, 1, 60);
    WEBCHAT = b.define("webchat.enabled", true);
    WEBCHAT_BIND = b.define("webchat.bind", "127.0.0.1");
    WEBCHAT_PORT = b.defineInRange("webchat.port", 8101, 1024, 65535);
    SPEC = b.build();
  }
}
