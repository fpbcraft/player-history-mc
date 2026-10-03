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
import java.util.function.Predicate;
import java.util.zip.ZipFile;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.ArmorItem;
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
  record Layer(
      String texture,
      String overlayTexture,
      float deformation,
      float headDeformation,
      boolean dyeable) {}
  record LayeredModel(int layer, List<Layer> layers) {}
  private record LayerSpec(String name, float deformation, float headDeformation) {}

  private static final Set<String> GENERIC_TOKENS =
      Set.of("armor", "armour", "robe", "robes", "gear", "set");
  private static final Set<String> MATERIAL_TOKENS =
      Set.of(
          "wood", "wooden", "stone", "chain", "chainmail", "iron", "gold", "golden",
          "diamond", "netherite", "leather", "copper");
  // Client armor renderers can deliberately reuse geometry under a different
  // texture/item family. Dedicated servers do not run those client registrations,
  // so keep the small set of known resource-only aliases explicit here.
  private static final Map<String, String> GEOMETRY_FAMILY_ALIASES =
      Map.ofEntries(
          Map.entry("armory_rpgs:astral_robe", "tirisfal_robe"),
          Map.entry("armory_rpgs:scarlet_robe", "tirisfal_robe"),
          Map.entry("armory_rpgs:glacier_robe", "tirisfal_robe"),
          Map.entry("armory_rpgs:smouldering_robe", "tempest_robe"),
          Map.entry("armory_rpgs:rimeweave_robe", "tempest_robe"));

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
      Model model = parseGeometry(root, textureId(texturePath));
      if (model == null || model.parts().isEmpty()) {
        missing.add(key);
        return null;
      }
      log.accept(
          "Resolved custom equipment "
              + item
              + " from "
              + geoPath
              + " using "
              + texturePath);
      cache.put(key, model);
      return model;
    } catch (RuntimeException error) {
      log.accept("Could not parse custom equipment geometry " + geoPath + ": " + error);
      missing.add(key);
      return null;
    }
  }


  LayeredModel resolveLayered(ResourceLocation item, ArmorItem.Type type) {
    return layeredModel(
        item.getNamespace(),
        family(item.getPath()),
        type == ArmorItem.Type.LEGGINGS,
        path -> assets.asset(path) != null);
  }

  static LayeredModel layeredModel(
      String namespace, String family, boolean leggings, Predicate<String> exists) {
    String directory =
        "assets/"
            + namespace
            + "/textures/models/armor/"
            + family
            + "/";
    List<LayerSpec> specs =
        leggings
            ? List.of(
                new LayerSpec("leggings_lower", 0.125f, 0.125f),
                new LayerSpec("leggings_middle", 0.5f, 0.5f),
                new LayerSpec("leggings_upper", 1.0f, 1.0f))
            : List.of(
                new LayerSpec("body_lower", 0.25f, 0.55f),
                new LayerSpec("body_middle", 0.75f, 0.9f),
                new LayerSpec("body_upper", 1.25f, 1.25f));

    var layers = new ArrayList<Layer>();
    for (LayerSpec spec : specs) {
      String base = directory + spec.name() + ".png";
      if (!exists.test(base)) continue;
      String overlayFile = directory + spec.name() + "_overlay.png";
      String overlay = exists.test(overlayFile) ? textureId(overlayFile) : null;
      layers.add(
          new Layer(
              textureId(base),
              overlay,
              spec.deformation(),
              spec.headDeformation(),
              overlay != null));
    }

    // Some segmented sets intentionally reuse one transparent sprite at all three
    // dilations (for example a gel/slime shell). Reproduce that stack when the
    // conventional lower/middle/upper files are absent.
    if (layers.isEmpty()) {
      String baseName = leggings ? "leggings" : "body";
      String base = directory + baseName + ".png";
      if (exists.test(base)) {
        String overlayFile = directory + baseName + "_overlay.png";
        String overlay = exists.test(overlayFile) ? textureId(overlayFile) : null;
        String texture = textureId(base);
        for (LayerSpec spec : specs)
          layers.add(
              new Layer(
                  texture,
                  overlay,
                  spec.deformation(),
                  spec.headDeformation(),
                  overlay != null));
      }
    }

    return layers.isEmpty()
        ? null
        : new LayeredModel(leggings ? 2 : 1, List.copyOf(layers));
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
    if (path.contains("/textures/armor/")
        && !path.contains("/textures/armor/trim/")
        && path.endsWith(".png")) {
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
    String geometryFamily = geometryFamily(namespace, family);
    List<String> candidates = geoByNamespace.getOrDefault(namespace, List.of());
    String exact = "assets/" + namespace + "/geo/" + geometryFamily + ".geo.json";
    if (candidates.contains(exact) && isHumanoid(exact)) return exact;

    List<String> humanoid = new ArrayList<>();
    for (String candidate : candidates) if (isHumanoid(candidate)) humanoid.add(candidate);
    if (humanoid.size() == 1) return humanoid.getFirst();
    return best(geometryFamily, humanoid, candidate -> stem(candidate, ".geo.json"));
  }

  static String geometryFamily(String namespace, String family) {
    return GEOMETRY_FAMILY_ALIASES.getOrDefault(namespace + ":" + family, family);
  }

  private boolean isHumanoid(String path) {
    byte[] bytes = assets.asset(path);
    if (bytes == null) return false;
    String text = new String(bytes, StandardCharsets.UTF_8);
    boolean biped =
        text.contains("bipedHead")
            && text.contains("bipedBody")
            && text.contains("bipedRightArm")
            && text.contains("bipedLeftArm")
            && text.contains("bipedRightLeg")
            && text.contains("bipedLeftLeg");
    boolean geckoArmor =
        text.contains("armorHead")
            || text.contains("armorBody")
            || text.contains("armorRightArm")
            || text.contains("armorLeftArm")
            || text.contains("armorRightLeg")
            || text.contains("armorLeftLeg")
            || text.contains("armorRightBoot")
            || text.contains("armorLeftBoot")
            || text.contains("armorWaist");
    return biped || geckoArmor;
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
    int marker = relative.indexOf("/textures/");
    if (slash <= 0 || marker < 0) throw new IllegalArgumentException("Invalid texture path: " + path);
    String namespace = relative.substring(0, slash);
    String texture = relative.substring(marker + "/textures/".length(), relative.length() - 4);
    return namespace + ":" + texture;
  }

  static Model parseGeometry(JsonObject root, String texture) {
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
                modelPoint(vec(bone.getAsJsonArray("pivot"), new float[] {0, 0, 0})),
                modelRotation(vec(bone.getAsJsonArray("rotation"), new float[] {0, 0, 0})),
                bone.has("mirror") && bone.get("mirror").getAsBoolean(),
                bone.has("inflate") ? bone.get("inflate").getAsFloat() : 0,
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
      Root semantic =
          switch (current.name()) {
            case "bipedHead", "armorHead" -> new Root(current, "head", "head");
            case "bipedBody", "armorBody" -> new Root(current, "torso", "chest");
            case "bipedRightArm", "armorRightArm" -> new Root(current, "rightArm", "chest");
            case "bipedLeftArm", "armorLeftArm" -> new Root(current, "leftArm", "chest");
            case "armorRightLeg" -> new Root(current, "rightLeg", "legs");
            case "armorLeftLeg" -> new Root(current, "leftLeg", "legs");
            case "armorRightBoot" -> new Root(current, "rightLeg", "feet");
            case "armorLeftBoot" -> new Root(current, "leftLeg", "feet");
            case "bipedWaist", "armorWaist" -> new Root(current, "torso", "legs");
            case "bipedRightLeg" -> new Root(current, "rightLeg", null);
            case "bipedLeftLeg" -> new Root(current, "leftLeg", null);
            default -> null;
          };
      if (semantic != null) return semantic;
      current = current.parent() == null ? null : definitions.get(current.parent());
    }
    return null;
  }

  private static String slotOf(Bone bone, Root root) {
    if (root.slot() != null) return root.slot();
    String name = bone.name().toLowerCase(Locale.ROOT);
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

    float inflate =
        cube.has("inflate") ? cube.get("inflate").getAsFloat() : bone.inflate();
    boolean mirror =
        cube.has("mirror") ? cube.get("mirror").getAsBoolean() : bone.mirror();

    // ArmorModelAPI bakes Bedrock armor without mirroring X. Player History
    // already renders in y-up model space, so the authored local axes can be
    // kept directly and converted only from pixels to blocks.
    float ox = origin[0] / 16f;
    float oy = origin[1] / 16f;
    float oz = origin[2] / 16f;
    float sx = size[0] / 16f;
    float sy = size[1] / 16f;
    float sz = size[2] / 16f;
    float inf = inflate / 16f;

    // Same vertex set/order as GeckoLib's VertexSet.
    float[][] vertices = {
      {ox - inf, oy - inf, oz - inf},
      {ox - inf, oy - inf, oz + sz + inf},
      {ox - inf, oy + sy + inf, oz - inf},
      {ox - inf, oy + sy + inf, oz + sz + inf},
      {ox + sx + inf, oy + sy + inf, oz - inf},
      {ox + sx + inf, oy + sy + inf, oz + sz + inf},
      {ox + sx + inf, oy - inf, oz - inf},
      {ox + sx + inf, oy - inf, oz + sz + inf}
    };

    float[] rawCubePivot = vec(cube.getAsJsonArray("pivot"), null);
    float[] cubePivot =
        rawCubePivot == null ? new float[] {0, 0, 0} : modelPoint(rawCubePivot);
    float[] cubeRotation =
        modelRotation(vec(cube.getAsJsonArray("rotation"), new float[] {0, 0, 0}));
    rotateAll(vertices, cubePivot, cubeRotation);

    Bone current = bone;
    for (int depth = 0; current != null && depth < 32; depth++) {
      rotateAll(vertices, current.pivot(), current.rotation());
      if (current == root.bone()) break;
      current = current.parent() == null ? null : definitions.get(current.parent());
    }

    for (float[] vertex : vertices) {
      vertex[0] -= root.bone().pivot()[0];
      vertex[1] -= root.bone().pivot()[1];
      vertex[2] -= root.bone().pivot()[2];

      // Armor Model API keeps authored X/Z orientation and rotation signs, but
      // Minecraft armor model front is -Z while the BlueMap skin mesh maps its
      // front UV onto Three.js BoxGeometry +Z. Reflect Z exactly once at this
      // integration boundary, after all authored pivots/rotations are applied.
      vertex[2] = -vertex[2];
    }

    JsonElement uvValue = cube.get("uv");
    if (uvValue == null) return;
    if (uvValue.isJsonArray()) {
      float[] uv = uvPair(uvValue);
      if (uv != null)
        out.box(
            vertices,
            size,
            uv[0],
            uv[1],
            textureWidth,
            textureHeight,
            mirror);
    } else if (uvValue.isJsonObject()) {
      out.mapped(
          vertices,
          uvValue.getAsJsonObject(),
          textureWidth,
          textureHeight,
          mirror);
    }
  }

  private static float[] uvPair(JsonElement value) {
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

  private static float[] modelPoint(float[] value) {
    return new float[] {value[0] / 16f, value[1] / 16f, value[2] / 16f};
  }

  private static float[] modelRotation(float[] value) {
    return value.clone();
  }

  private static void rotateAll(float[][] vertices, float[] pivot, float[] degrees) {
    for (float[] vertex : vertices) rotate(vertex, pivot, degrees);
  }

  private static void rotate(float[] point, float[] pivot, float[] degrees) {
    double x = point[0] - pivot[0];
    double y = point[1] - pivot[1];
    double z = point[2] - pivot[2];

    double rx = Math.toRadians(degrees[0]);
    double ry = Math.toRadians(degrees[1]);
    double rz = Math.toRadians(degrees[2]);

    double cos = Math.cos(rx), sin = Math.sin(rx);
    double y1 = y * cos - z * sin;
    double z1 = y * sin + z * cos;
    y = y1;
    z = z1;

    cos = Math.cos(ry);
    sin = Math.sin(ry);
    double x1 = x * cos + z * sin;
    double z2 = -x * sin + z * cos;
    x = x1;
    z = z2;

    cos = Math.cos(rz);
    sin = Math.sin(rz);
    double x2 = x * cos - y * sin;
    double y2 = x * sin + y * cos;

    point[0] = (float) (x2 + pivot[0]);
    point[1] = (float) (y2 + pivot[1]);
    point[2] = (float) (z + pivot[2]);
  }

  private record Bone(
      String name,
      String parent,
      float[] pivot,
      float[] rotation,
      boolean mirror,
      float inflate,
      JsonArray cubes) {}
  private record Root(Bone bone, String part, String slot) {}

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
      float dx = (float) Math.floor(size[0]);
      float dy = (float) Math.floor(size[1]);
      float dz = (float) Math.floor(size[2]);

      // Vertex order and box-UV windows mirror GeckoLib's VertexSet and
      // GeometryQuadUvs.ofBoxUv exactly.
      face(
          v,
          mirror ? new int[] {4, 5, 7, 6} : new int[] {3, 2, 0, 1},
          uvRect(u + dz + dx, w + dz, dz, dy, textureWidth, textureHeight, mirror));
      face(
          v,
          mirror ? new int[] {3, 2, 0, 1} : new int[] {4, 5, 7, 6},
          uvRect(u, w + dz, dz, dy, textureWidth, textureHeight, mirror));
      face(
          v,
          new int[] {2, 4, 6, 0},
          uvRect(u + dz, w + dz, dx, dy, textureWidth, textureHeight, mirror));
      face(
          v,
          new int[] {5, 3, 1, 7},
          uvRect(u + dz + dx + dz, w + dz, dx, dy, textureWidth, textureHeight, mirror));
      face(
          v,
          new int[] {3, 5, 4, 2},
          uvRect(u + dz, w, dx, dz, textureWidth, textureHeight, mirror));
      face(
          v,
          new int[] {0, 6, 7, 1},
          uvRect(u + dz + dx, w + dz, dx, -dz, textureWidth, textureHeight, mirror));
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

    private static float[][] uvRect(
        float u,
        float v,
        float width,
        float height,
        int textureWidth,
        int textureHeight,
        boolean mirror) {
      float u0 = u / textureWidth;
      float u1 = (u + width) / textureWidth;
      float v0 = 1f - v / textureHeight;
      float v1 = 1f - (v + height) / textureHeight;

      // GeckoLib reverses U for ordinary box UVs and keeps it forward for mirror.
      if (!mirror) {
        float swap = u0;
        u0 = u1;
        u1 = swap;
      }

      return new float[][] {
        {u0, v0}, {u1, v0}, {u1, v1}, {u0, v1}
      };
    }

    void mapped(
        float[][] vertices,
        JsonObject mapping,
        int textureWidth,
        int textureHeight,
        boolean mirror) {
      mappedFace(vertices, mapping, "west", mirror ? new int[] {4, 5, 7, 6} : new int[] {3, 2, 0, 1}, textureWidth, textureHeight, mirror);
      mappedFace(vertices, mapping, "east", mirror ? new int[] {3, 2, 0, 1} : new int[] {4, 5, 7, 6}, textureWidth, textureHeight, mirror);
      mappedFace(vertices, mapping, "north", new int[] {2, 4, 6, 0}, textureWidth, textureHeight, mirror);
      mappedFace(vertices, mapping, "south", new int[] {5, 3, 1, 7}, textureWidth, textureHeight, mirror);
      mappedFace(vertices, mapping, "up", mirror ? new int[] {0, 6, 7, 1} : new int[] {3, 5, 4, 2}, textureWidth, textureHeight, mirror);
      mappedFace(vertices, mapping, "down", mirror ? new int[] {3, 5, 4, 2} : new int[] {0, 6, 7, 1}, textureWidth, textureHeight, mirror);
    }

    private void mappedFace(
        float[][] vertices,
        JsonObject mapping,
        String name,
        int[] corners,
        int textureWidth,
        int textureHeight,
        boolean mirror) {
      JsonElement element = mapping.get(name);
      if (element == null || !element.isJsonObject()) return;
      JsonObject face = element.getAsJsonObject();
      float[] uv = uvPair(face.get("uv"));
      float[] size = uvPair(face.get("uv_size"));
      if (uv == null || size == null) return;
      int rotation =
          face.has("uv_rotation")
              ? (Math.floorMod(face.get("uv_rotation").getAsInt(), 360) / 90) * 90
              : 0;
      float[][] coordinates =
          uvRect(
              uv[0],
              uv[1],
              size[0],
              size[1],
              textureWidth,
              textureHeight,
              mirror);
      if (rotation == 90) coordinates = rotateUvs(coordinates, 1);
      else if (rotation == 180) coordinates = rotateUvs(coordinates, 2);
      else if (rotation == 270) coordinates = rotateUvs(coordinates, 3);
      face(vertices, corners, coordinates);
    }

    private static float[][] rotateUvs(float[][] source, int amount) {
      float[][] result = new float[4][];
      for (int i = 0; i < 4; i++) result[i] = source[(i + amount) % 4];
      return result;
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
