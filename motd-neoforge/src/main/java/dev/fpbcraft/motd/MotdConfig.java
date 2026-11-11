package dev.fpbcraft.motd;

import java.util.List;
import net.neoforged.neoforge.common.ModConfigSpec;

public final class MotdConfig {
  public static final ModConfigSpec SPEC;
  public static final ModConfigSpec.BooleanValue ENABLED;
  public static final ModConfigSpec.IntValue ROTATION_SECONDS;
  public static final ModConfigSpec.ConfigValue<String> TIMEZONE, HEADER, PACK_VERSION;
  public static final ModConfigSpec.ConfigValue<List<? extends String>> MESSAGES;

  static {
    var b = new ModConfigSpec.Builder();
    ENABLED = b.comment("Enable the rotating server-list MOTD.").define("enabled", true);
    ROTATION_SECONDS = b.comment("Interval between displayed messages.")
        .defineInRange("rotation-seconds", 45, 5, 3600);
    TIMEZONE = b.comment("IANA timezone used for daily and weekly player statistics.")
        .define("timezone", "America/Toronto");
    HEADER = b.comment("First line of the MOTD. Minecraft section-sign formatting codes are supported.")
        .define("header", "§aFPBCRAFT §7• §fSurvival & Create");
    PACK_VERSION = b.comment("Optional label for the {pack_version} placeholder.")
        .define("pack-version", "");
    MESSAGES = b.comment(
            "Rotating second lines. Use [empty] or [online] before a line to restrict it.",
            "Placeholders: {online}, {players_today}, {players_week}, {playtime_today},",
            "{peak_today}, {last_online}, {last_player}, {uptime}, {world_day}, {pack_version}.")
        .defineListAllowEmpty("messages",
            List.of(
                "§e{players_today} §7players today • §b{playtime_today} §7played",
                "[empty] §7Last player online §e{last_online} §7ago",
                "[online] §a{online} §7players exploring right now!",
                "§7Today's peak: §e{peak_today} §7online",
                "§7Server uptime: §a{uptime}",
                "§7World day: §e{world_day}"),
            () -> "",
            value -> value instanceof String);
    SPEC = b.build();
  }

  private MotdConfig() {}
}
