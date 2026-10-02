package dev.playerhistory.bluemap;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import dev.playerhistory.core.JsonFiles;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.function.Consumer;
import java.util.zip.ZipFile;
import net.minecraft.resources.ResourceLocation;
import net.neoforged.fml.ModList;

/**
 * Discovers humanoid custom-equipment geometry from installed mod resources.
 *
 * <p>The resolver is intentionally convention based rather than mod based. It indexes
 * Bedrock/Gecko-style {@code assets/<namespace>/geo/*.geo.json} models and armor textures,
 * then matches them to an equipped item family. Resource bytes are read back through
 * BlueMap3D's AssetIndex so configured resource-pack overrides still win.
 */
final class CustomArmorAssetResolver {
  record Part(String parent, String slot, float[] positions, float[] uvs) {}
  record Model(String texture, List<Part> parts) {}

  private static final Set<String> GENERIC_TOKENS =
      Set.of("armor", "armour", "robe", "robes", "gear", "set");
  private static final Set<String> MATERIAL_TOKENS =
      Set.of(
          "wood", "wooden", "stone", "chain", "chainmail", "iron", "gold", "golden",
          "diamond", "netherite", "leather", "copper");

  private final BlueMap3DItemModelBridge assets;
  private final Consumer<String> log;
  private final Map<String, List<String>> geoByNamespace = new HashMap<>();
  private final Map<String, List<String>> armorTexturesByNamespace = new HashMap<>();
  private final Map<String, Model> cache = new HashMap<>();
  private final Set<String> missing = new HashSet<>();

  CustomArmorAssetResolver(BlueMap3DItemModelBridge assets, Consumer<String> log) {
    this.assets = assets;
    this.log = log;
    indexInstalledMods();
  }

  Model resolve(ResourceLocation item) {
    String key = item.toString();
    Model cached = cache.get(key);
    if (cached != null) return cached;
    if (missing.contains(key)) return null;

    String family = family(item.getPath());
    String texturePath = chooseTexture(item.getNamespace(), family);
    String geoPath = chooseGeo(item.getNamespace(), family);
    if (texturePath == null || geoPath == null) {
      missing.add(key);
      return null;
    }

    byte[] geometryBytes = assets.asset(geoPath);
    if (geometryBytes == null) {
      missing.add(key);
      return null;
    }

    try {
      JsonObject root =
          JsonFiles.GSON.fromJson(
              new String(geometryBytes, StandardCharsets.UTF_8), JsonObject.class);
      Model model = parse(root, textureId(texturePath));
      if (model == null || model.parts().isEmpty()) {
        missing.add(key);
        return null;
      }
      cache.put(key, model);
      return model;
    } catch (RuntimeException error) {
      log.accept("Could not parse custom equipment geometry " + geoPath + ": " + error);
      missing.add(key);
      return null;
    }
  }

  private void indexInstalledMods() {
    int geos = 0;
    int textures = 0;
    try {
      var modList = ModList.get();
      if (modList == null) return;
      for (var info : modList.getModFiles()) {
        var file = info.getFile();
        if (file == null || file.getFilePath() == null) continue;
        Path path = file.getFilePath();
        try {
          if (Files.isDirectory(path)) {
            try (var stream = Files.walk(path)) {
              for (Path entry : stream.filter(Files::isRegularFile).toList()) {
                String relative = path.relativize(entry).toString().replace('\\', '/');
                if (index(relative)) {
                  if (relative.contains("/geo/")) geos++;
                  else textures++;
                }
              }
            }
          } else if (Files.isRegularFile(path)) {
            try (var zip = new ZipFile(path.toFile())) {
              var entries = zip.entries();
              while (entries.hasMoreElements()) {
                var entry = entries.nextElement();
                if (entry.isDirectory()) continue;
                String relative = entry.getName();
                if (index(relative)) {
                  if (relative.contains("/geo/")) geos++;
                  else textures++;
                }
              }
            }
          }
        } catch (IOException | RuntimeException ignored) {
          // One unusual mod container must not disable discovery for the rest.
        }
      }
    } catch (RuntimeException error) {
      log.accept("Could not index custom equipment assets: " + error);
      return;
    }
    if (geos > 0)
      log.accept(
          "Indexed "
              + geos
              + " humanoid geometry candidate(s) and "
              + textures
              + " armor texture candidate(s)");
  }

  private boolean index(String path) {
    if (!path.startsWith("assets/")) return false;
    String[] segments = path.split("/");
    if (segments.length < 4) return false;
    String namespace = segments[1];
    if (path.contains("/geo/") && path.endsWith(".geo.json")) {
      geoByNamespace.computeIfAbsent(namespace, ignored -> new ArrayList<>()).add(path);
      return true;
    }
    if (path.contains("/textures/armor/") && path.endsWith(".png")) {
      armorTexturesByNamespace
          .computeIfAbsent(namespace, ignored -> new ArrayList<>())
          .add(path);
      return true;
    }
    return false;
  }

  private String chooseTexture(String namespace, String family) {
    String exact = "assets/" + namespace + "/textures/armor/" + family + ".png";
    if (assets.asset(exact) != null) return exact;
    return best(
        family,
        armorTexturesByNamespace.getOrDefault(namespace, List.of()),
        candidate -> stem(candidate, ".png"));
  }

  private String chooseGeo(String namespace, String family) {
    List<String> candidates = geoByNamespace.getOrDefault(namespace, List.of());
    String exact = "assets/" + namespace + "/geo/" + family + ".geo.json";
    if (candidates.contains(exact) && isHumanoid(exact)) return exact;

    List<String> humanoid = new ArrayList<>();
    for (String candidate : candidates) if (isHumanoid(candidate)) humanoid.add(candidate);
    if (humanoid.size() == 1) return humanoid.getFirst();
    return best(family, humanoid, candidate -> stem(candidate, ".geo.json"));
  }

  private boolean isHumanoid(String path) {
    byte[] bytes = assets.asset(path);
    if (bytes == null) return false;
    String text = new String(bytes, StandardCharsets.UTF_8);
    return text.contains("bipedHead")
        && text.contains("bipedBody")
        && text.contains("bipedRightArm")
        && text.contains("bipedLeftArm")
        && text.contains("bipedRightLeg")
        && text.contains("bipedLeftLeg");
  }

  private static String best(
      String family, List<String> candidates, java.util.function.Function<String, String> name) {
    String winner = null;
    int winnerScore = 0;
    boolean tied = false;
    for (String candidate : candidates) {
      int score = score(family, name.apply(candidate));
      if (score > winnerScore) {
        winner = candidate;
        winnerScore = score;
        tied = false;
      } else if (score > 0 && score == winnerScore) {
        tied = true;
      }
    }
    return winnerScore > 0 && !tied ? winner : null;
  }

  private static int score(String family, String candidate) {
    String a = normalize(family);
    String b = normalize(candidate);
    if (a.equals(b)) return 1000;
    if (a.contains(b) || b.contains(a)) return 100;

    Set<String> left = tokens(a);
    Set<String> right = tokens(b);
    int score = 0;
    for (String token : left) {
      if (!right.contains(token)) continue;
      if (MATERIAL_TOKENS.contains(token)) score += 2;
      else if (GENERIC_TOKENS.contains(token)) score += 1;
      else score += 8;
    }
    return score;
  }

  private static Set<String> tokens(String value) {
    var out = new LinkedHashSet<String>();
    for (String raw : value.split("[_./-]+")) {
      if (raw.isBlank()) continue;
      String token = raw.endsWith("s") && raw.length() > 4 ? raw.substring(0, raw.length() - 1) : raw;
      out.add(token);
    }
    return out;
  }

  private static String normalize(String value) {
    return value.toLowerCase(Locale.ROOT).replace('-', '_');
  }

  private static String family(String path) {
    for (String suffix :
        List.of(
            "_chestplate", "_leggings", "_helmet", "_boots",
            "_chest", "_legs", "_head", "_feet")) {
      if (path.endsWith(suffix)) return path.substring(0, path.length() - suffix.length());
    }
    return path;
  }

  private static String stem(String path, String suffix) {
    int slash = path.lastIndexOf('/');
    String value = slash >= 0 ? path.substring(slash + 1) : path;
    return value.endsWith(suffix) ? value.substring(0, value.length() - suffix.length()) : value;
  }

  private static String textureId(String path) {
    String relative = path.substring("assets/".length());
    int slash = relative.indexOf('/');
    String namespace = relative.substring(0, slash);
    String texture = relative.substring(slash + "/textures/".length() + 1, relative.length() - 4);
    return namespace + ":" + texture;
  }

  private static Model parse(JsonObject root, String texture) {
    JsonArray geometries = root == null ? null : root.getAsJsonArray("minecraft:geometry");
    if (geometries == null) return null;

    for (JsonElement geometryElement : geometries) {
      if (!geometryElement.isJsonObject()) continue;
      JsonObject geometry = geometryElement.getAsJsonObject();
      JsonObject description = geometry.getAsJsonObject("description");
      JsonArray bones = geometry.getAsJsonArray("bones");
      if (description == null || bones == null) continue;
      int width = description.has("texture_width") ? description.get("texture_width").getAsInt() : 64;
      int height = description.has("texture_height") ? description.get("texture_height").getAsInt() : 64;

      Map<String, Bone> definitions = new LinkedHashMap<>();
      for (JsonElement element : bones) {
        if (!element.isJsonObject()) continue;
        JsonObject bone = element.getAsJsonObject();
        if (!bone.has("name")) continue;
        String name = bone.get("name").getAsString();
        definitions.put(
            name,
            new Bone(
                name,
                bone.has("parent") ? bone.get("parent").getAsString() : null,
                vec(bone.getAsJsonArray("pivot"), new float[] {0, 0, 0}),
                vec(bone.getAsJsonArray("rotation"), new float[] {0, 0, 0}),
                bone.getAsJsonArray("cubes")));
      }

      var grouped = new LinkedHashMap<String, MeshBuilder>();
      for (Bone bone : definitions.values()) {
        Root rootBone = rootOf(bone, definitions);
        if (rootBone == null || bone.cubes() == null) continue;
        String slot = slotOf(bone, rootBone);
        String groupKey = rootBone.part() + "|" + slot;
        MeshBuilder builder = grouped.computeIfAbsent(groupKey, ignored -> new MeshBuilder());
        for (JsonElement cubeElement : bone.cubes()) {
          if (!cubeElement.isJsonObject()) continue;
          appendCube(
              builder,
              cubeElement.getAsJsonObject(),
              bone,
              rootBone,
              definitions,
              width,
              height);
        }
      }

      var parts = new ArrayList<Part>();
      for (var entry : grouped.entrySet()) {
        if (entry.getValue().empty()) continue;
        String[] key = entry.getKey().split("\\|", 2);
        parts.add(
            new Part(
                key[0],
                key[1],
                entry.getValue().positions(),
                entry.getValue().uvs()));
      }
      if (!parts.isEmpty()) return new Model(texture, List.copyOf(parts));
    }
    return null;
  }

  private static Root rootOf(Bone bone, Map<String, Bone> definitions) {
    Bone current = bone;
    for (int depth = 0; current != null && depth < 32; depth++) {
      String part =
          switch (current.name()) {
            case "bipedHead" -> "head";
            case "bipedBody" -> "torso";
            case "bipedRightArm" -> "rightArm";
            case "bipedLeftArm" -> "leftArm";
            case "bipedRightLeg" -> "rightLeg";
            case "bipedLeftLeg" -> "leftLeg";
            default -> null;
          };
      if (part != null) return new Root(current, part);
      current = current.parent() == null ? null : definitions.get(current.parent());
    }
    return null;
  }

  private static String slotOf(Bone bone, Root root) {
    String name = bone.name().toLowerCase(Locale.ROOT);
    if (root.part().equals("head")) return "head";
    if (root.part().equals("torso") || root.part().endsWith("Arm")) return "chest";
    return name.contains("boot") || name.contains("foot") ? "feet" : "legs";
  }

  private static void appendCube(
      MeshBuilder out,
      JsonObject cube,
      Bone bone,
      Root root,
      Map<String, Bone> definitions,
      int textureWidth,
      int textureHeight) {
    float[] origin = vec(cube.getAsJsonArray("origin"), null);
    float[] size = vec(cube.getAsJsonArray("size"), null);
    if (origin == null || size == null || !cube.has("uv")) return;
    float inflate = cube.has("inflate") ? cube.get("inflate").getAsFloat() : 0;
    float[] min = {
      origin[0] - inflate, origin[1] - inflate, origin[2] - inflate
    };
    float[] max = {
      origin[0] + size[0] + inflate,
      origin[1] + size[1] + inflate,
      origin[2] + size[2] + inflate
    };

    float[][] vertices = {
      {min[0], min[1], min[2]}, {max[0], min[1], min[2]},
      {max[0], max[1], min[2]}, {min[0], max[1], min[2]},
      {min[0], min[1], max[2]}, {max[0], min[1], max[2]},
      {max[0], max[1], max[2]}, {min[0], max[1], max[2]}
    };

    float[] cubePivot = vec(cube.getAsJsonArray("pivot"), bone.pivot());
    float[] cubeRotation = vec(cube.getAsJsonArray("rotation"), new float[] {0, 0, 0});
    for (float[] vertex : vertices) rotate(vertex, cubePivot, cubeRotation);

    Bone current = bone;
    for (int depth = 0; current != null && depth < 32; depth++) {
      rotateAll(vertices, current.pivot(), current.rotation());
      if (current == root.bone()) break;
      current = current.parent() == null ? null : definitions.get(current.parent());
    }

    for (float[] vertex : vertices) {
      vertex[0] = (vertex[0] - root.bone().pivot()[0]) / 16f;
      vertex[1] = (vertex[1] - root.bone().pivot()[1]) / 16f;
      vertex[2] = (vertex[2] - root.bone().pivot()[2]) / 16f;
    }

    float[] uv = uv(cube.get("uv"));
    if (uv == null) return;
    boolean mirror = cube.has("mirror") && cube.get("mirror").getAsBoolean();
    out.box(vertices, size, uv[0], uv[1], textureWidth, textureHeight, mirror);
  }

  private static float[] uv(JsonElement value) {
    if (value == null || !value.isJsonArray()) return null;
    JsonArray array = value.getAsJsonArray();
    return array.size() >= 2
        ? new float[] {array.get(0).getAsFloat(), array.get(1).getAsFloat()}
        : null;
  }

  private static float[] vec(JsonArray value, float[] fallback) {
    if (value == null || value.size() < 3) return fallback == null ? null : fallback.clone();
    return new float[] {
      value.get(0).getAsFloat(), value.get(1).getAsFloat(), value.get(2).getAsFloat()
    };
  }

  private static void rotateAll(float[][] vertices, float[] pivot, float[] degrees) {
    for (float[] vertex : vertices) rotate(vertex, pivot, degrees);
  }

  private static void rotate(float[] point, float[] pivot, float[] degrees) {
    if (degrees == null) return;
    double x = point[0] - pivot[0];
    double y = point[1] - pivot[1];
    double z = point[2] - pivot[2];

    double rx = Math.toRadians(degrees[0]);
    double ry = Math.toRadians(degrees[1]);
    double rz = Math.toRadians(degrees[2]);

    double cy = Math.cos(rx), sy = Math.sin(rx);
    double y1 = y * cy - z * sy;
    double z1 = y * sy + z * cy;
    y = y1;
    z = z1;

    double cx = Math.cos(ry), sx = Math.sin(ry);
    double x1 = x * cx + z * sx;
    double z2 = -x * sx + z * cx;
    x = x1;
    z = z2;

    double cz = Math.cos(rz), sz = Math.sin(rz);
    double x2 = x * cz - y * sz;
    double y2 = x * sz + y * cz;

    point[0] = (float) (x2 + pivot[0]);
    point[1] = (float) (y2 + pivot[1]);
    point[2] = (float) (z + pivot[2]);
  }

  private record Bone(
      String name, String parent, float[] pivot, float[] rotation, JsonArray cubes) {}
  private record Root(Bone bone, String part) {}

  private static final class MeshBuilder {
    private final ArrayList<Float> positions = new ArrayList<>();
    private final ArrayList<Float> uvs = new ArrayList<>();

    boolean empty() {
      return positions.isEmpty();
    }

    void box(
        float[][] v,
        float[] size,
        float u,
        float w,
        int textureWidth,
        int textureHeight,
        boolean mirror) {
      float dx = size[0], dy = size[1], dz = size[2];
      face(v, new int[] {1, 5, 6, 2}, rect(u + dz + dx, w + dz, dz, dy, textureWidth, textureHeight, mirror));
      face(v, new int[] {4, 0, 3, 7}, rect(u, w + dz, dz, dy, textureWidth, textureHeight, mirror));
      face(v, new int[] {3, 2, 6, 7}, rect(u + dz, w, dx, dz, textureWidth, textureHeight, mirror));
      face(v, new int[] {4, 5, 1, 0}, rect(u + dz + dx, w, dx, dz, textureWidth, textureHeight, mirror));
      face(v, new int[] {5, 4, 7, 6}, rect(u + dz + dx + dz, w + dz, dx, dy, textureWidth, textureHeight, mirror));
      face(v, new int[] {0, 1, 2, 3}, rect(u + dz, w + dz, dx, dy, textureWidth, textureHeight, mirror));
    }

    private void face(float[][] vertices, int[] corners, float[][] uv) {
      int[] triangles = {0, 1, 2, 0, 2, 3};
      for (int index : triangles) {
        float[] vertex = vertices[corners[index]];
        positions.add(vertex[0]);
        positions.add(vertex[1]);
        positions.add(vertex[2]);
        uvs.add(uv[index][0]);
        uvs.add(uv[index][1]);
      }
    }

    private static float[][] rect(
        float x, float y, float width, float height, int textureWidth, int textureHeight, boolean mirror) {
      float left = x / textureWidth;
      float right = (x + width) / textureWidth;
      float top = 1f - y / textureHeight;
      float bottom = 1f - (y + height) / textureHeight;
      if (mirror) {
        float swap = left;
        left = right;
        right = swap;
      }
      return new float[][] {
        {left, bottom}, {right, bottom}, {right, top}, {left, top}
      };
    }

    float[] positions() {
      float[] result = new float[positions.size()];
      for (int i = 0; i < result.length; i++) result[i] = positions.get(i);
      return result;
    }

    float[] uvs() {
      float[] result = new float[uvs.size()];
      for (int i = 0; i < result.length; i++) result[i] = uvs.get(i);
      return result;
    }
  }
}
