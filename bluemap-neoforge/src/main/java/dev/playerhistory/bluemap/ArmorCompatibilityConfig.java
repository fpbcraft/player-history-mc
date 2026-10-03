package dev.playerhistory.bluemap;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Consumer;

/**
 * Loads the small amount of mod-specific metadata that cannot be inferred from resources alone.
 *
 * <p>Built-in mappings ship with the mod. Server owners may add or override mappings in
 * {@code config/playerhistory_bluemap-armor.json} without rebuilding Player History.
 */
final class ArmorCompatibilityConfig {
  private static final String BUILTIN_RESOURCE = "/playerhistory-armor-compat.json";
  private static final String OVERRIDE_FILE = "playerhistory_bluemap-armor.json";

  record Data(Map<String, String> geometryAliases, Map<String, String> textureAliases) {
    String geometryFamily(String namespace, String family) {
      return geometryAliases.getOrDefault(namespace + ":" + family, family);
    }

    String textureFamily(String namespace, String family) {
      return textureAliases.getOrDefault(namespace + ":" + family, family);
    }
  }

  static Data load(Path serverRoot, Consumer<String> log) {
    Data defaults = defaults();
    var geometry = new LinkedHashMap<>(defaults.geometryAliases());
    var textures = new LinkedHashMap<>(defaults.textureAliases());

    Path override = serverRoot.resolve("config").resolve(OVERRIDE_FILE);
    if (Files.isRegularFile(override)) {
      try (var reader = Files.newBufferedReader(override, StandardCharsets.UTF_8)) {
        merge(JsonParser.parseReader(reader).getAsJsonObject(), geometry, textures);
        log.accept(
            "Loaded armor compatibility overrides from "
                + override
                + " ("
                + geometry.size()
                + " geometry mappings, "
                + textures.size()
                + " texture mappings)");
      } catch (IOException | RuntimeException error) {
        log.accept("Could not load armor compatibility overrides " + override + ": " + error);
      }
    }

    return new Data(Map.copyOf(geometry), Map.copyOf(textures));
  }

  static Data defaults() {
    try (var stream = ArmorCompatibilityConfig.class.getResourceAsStream(BUILTIN_RESOURCE)) {
      if (stream == null) return new Data(Map.of(), Map.of());
      try (var reader = new InputStreamReader(stream, StandardCharsets.UTF_8)) {
        var geometry = new LinkedHashMap<String, String>();
        var textures = new LinkedHashMap<String, String>();
        merge(JsonParser.parseReader(reader).getAsJsonObject(), geometry, textures);
        return new Data(Map.copyOf(geometry), Map.copyOf(textures));
      }
    } catch (IOException | RuntimeException error) {
      return new Data(Map.of(), Map.of());
    }
  }

  private static void merge(
      JsonObject root, Map<String, String> geometry, Map<String, String> textures) {
    aliases(root.get("geometryAliases"), geometry);
    aliases(root.get("textureAliases"), textures);
  }

  private static void aliases(JsonElement element, Map<String, String> target) {
    if (element == null || !element.isJsonObject()) return;
    for (var entry : element.getAsJsonObject().entrySet()) {
      if (!entry.getValue().isJsonPrimitive()) continue;
      String key = entry.getKey().trim();
      String value = entry.getValue().getAsString().trim();
      if (key.isEmpty() || value.isEmpty() || !key.contains(":")) continue;
      target.put(key, value);
    }
  }

  private ArmorCompatibilityConfig() {}
}
