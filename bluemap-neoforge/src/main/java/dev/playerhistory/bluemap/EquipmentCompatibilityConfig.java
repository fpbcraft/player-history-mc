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
 * Loads mod-specific equipment metadata that cannot be inferred from standard APIs/resources.
 *
 * <p>Built-in mappings ship with the mod. Server owners may add or override mappings in
 * {@code config/playerhistory_bluemap-equipment.json} without rebuilding Player History.
 */
final class EquipmentCompatibilityConfig {
  private static final String BUILTIN_RESOURCE = "/playerhistory-equipment-compat.json";
  private static final String OVERRIDE_FILE = "playerhistory_bluemap-equipment.json";

  record Wearable(
      String parent, double[] position, double[] rotationDegrees, double scale) {}

  record Data(
      Map<String, String> geometryAliases,
      Map<String, String> textureAliases,
      Map<String, Wearable> wearableSlots,
      Map<String, Wearable> wearableItems) {
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
    var slots = new LinkedHashMap<>(defaults.wearableSlots());
    var items = new LinkedHashMap<>(defaults.wearableItems());

    Path override = serverRoot.resolve("config").resolve(OVERRIDE_FILE);
    if (Files.isRegularFile(override)) {
      try (var reader = Files.newBufferedReader(override, StandardCharsets.UTF_8)) {
        merge(JsonParser.parseReader(reader).getAsJsonObject(), geometry, textures, slots, items);
        log.accept("Loaded equipment compatibility overrides from " + override);
      } catch (IOException | RuntimeException error) {
        log.accept("Could not load equipment compatibility overrides " + override + ": " + error);
      }
    }

    return new Data(
        Map.copyOf(geometry), Map.copyOf(textures), Map.copyOf(slots), Map.copyOf(items));
  }

  static Data defaults() {
    try (var stream = EquipmentCompatibilityConfig.class.getResourceAsStream(BUILTIN_RESOURCE)) {
      if (stream == null) return empty();
      try (var reader = new InputStreamReader(stream, StandardCharsets.UTF_8)) {
        var geometry = new LinkedHashMap<String, String>();
        var textures = new LinkedHashMap<String, String>();
        var slots = new LinkedHashMap<String, Wearable>();
        var items = new LinkedHashMap<String, Wearable>();
        merge(JsonParser.parseReader(reader).getAsJsonObject(), geometry, textures, slots, items);
        return new Data(
            Map.copyOf(geometry), Map.copyOf(textures), Map.copyOf(slots), Map.copyOf(items));
      }
    } catch (IOException | RuntimeException error) {
      return empty();
    }
  }

  private static Data empty() {
    return new Data(Map.of(), Map.of(), Map.of(), Map.of());
  }

  private static void merge(
      JsonObject root,
      Map<String, String> geometry,
      Map<String, String> textures,
      Map<String, Wearable> slots,
      Map<String, Wearable> items) {
    aliases(root.get("geometryAliases"), geometry);
    aliases(root.get("textureAliases"), textures);
    wearables(root.get("wearableSlots"), slots, false);
    wearables(root.get("wearableItems"), items, true);
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

  private static void wearables(
      JsonElement element, Map<String, Wearable> target, boolean resourceKeys) {
    if (element == null || !element.isJsonObject()) return;
    for (var entry : element.getAsJsonObject().entrySet()) {
      String key = entry.getKey().trim();
      if (key.isEmpty() || (resourceKeys && !key.contains(":"))) continue;
      Wearable wearable = wearable(entry.getValue());
      if (wearable != null) target.put(key, wearable);
    }
  }

  private static Wearable wearable(JsonElement element) {
    if (element == null || !element.isJsonObject()) return null;
    JsonObject object = element.getAsJsonObject();
    String parent = string(object, "parent");
    if (!java.util.Set.of("head", "torso", "rightArm", "leftArm", "rightLeg", "leftLeg")
        .contains(parent)) return null;
    double[] position = vector(object.get("position"));
    double[] rotation = vector(object.get("rotationDegrees"));
    JsonElement scaleElement = object.get("scale");
    if (position == null
        || rotation == null
        || scaleElement == null
        || !scaleElement.isJsonPrimitive()
        || !scaleElement.getAsJsonPrimitive().isNumber()) return null;
    double scale = scaleElement.getAsDouble();
    if (!Double.isFinite(scale) || scale <= 0 || scale > 4) return null;
    return new Wearable(parent, position, rotation, scale);
  }

  private static String string(JsonObject object, String key) {
    JsonElement element = object.get(key);
    return element != null && element.isJsonPrimitive() && element.getAsJsonPrimitive().isString()
        ? element.getAsString()
        : "";
  }

  private static double[] vector(JsonElement element) {
    if (element == null || !element.isJsonArray() || element.getAsJsonArray().size() != 3)
      return null;
    double[] result = new double[3];
    for (int i = 0; i < 3; i++) {
      JsonElement value = element.getAsJsonArray().get(i);
      if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber()) return null;
      result[i] = value.getAsDouble();
      if (!Double.isFinite(result[i]) || Math.abs(result[i]) > 360) return null;
    }
    return result;
  }

  private EquipmentCompatibilityConfig() {}
}
