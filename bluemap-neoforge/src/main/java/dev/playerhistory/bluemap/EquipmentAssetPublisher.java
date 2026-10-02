package dev.playerhistory.bluemap;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import dev.playerhistory.core.JsonFiles;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import javax.imageio.ImageIO;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.ArmorItem;
import net.minecraft.world.item.Equipable;

/**
 * Publishes resolved resource models only for item ids that have actually appeared in
 * Player History's registry.
 *
 * <p>Descriptors contain expanded triangles in centered one-block model space and direct
 * normalized UVs, so the browser only needs BufferGeometry plus the named texture.
 */
final class EquipmentAssetPublisher {
  private static final int FORMAT = 1;
  private static final int ARMOR_FORMAT = 2;
  private static final long SCAN_INTERVAL_MS = 30_000;

  private final Consumer<String> log;
  private final ExecutorService worker;
  private final AtomicBoolean scanning = new AtomicBoolean();
  private final Set<String> processed = ConcurrentHashMap.newKeySet();

  private volatile Path root;
  private volatile Path registry;
  private volatile BlueMap3DItemModelBridge bridge;
  private volatile CustomArmorAssetResolver customArmor;
  private volatile long nextScan;

  EquipmentAssetPublisher(Consumer<String> log) {
    this.log = log;
    worker =
        Executors.newSingleThreadExecutor(
            runnable -> {
              Thread thread = new Thread(runnable, "player-history-equipment-assets");
              thread.setDaemon(true);
              thread.setPriority(Thread.NORM_PRIORITY - 1);
              return thread;
            });
  }

  synchronized void configure(Path webRoot, Path worldRoot) {
    disable();
    root = webRoot.resolve("player-history/equipment").toAbsolutePath().normalize();
    registry = worldRoot.resolve("player-history/registry.json").toAbsolutePath().normalize();
    processed.clear();
    nextScan = 0;
  }

  synchronized void disable() {
    root = null;
    registry = null;
    processed.clear();
    BlueMap3DItemModelBridge current = bridge;
    bridge = null;
    customArmor = null;
    if (current != null) current.close();
  }

  void tick(Path ignoredWorldRoot) {
    if (root == null || registry == null) return;
    long now = System.currentTimeMillis();
    if (now < nextScan || !scanning.compareAndSet(false, true)) return;
    nextScan = now + SCAN_INTERVAL_MS;
    worker.execute(
        () -> {
          try {
            scan();
          } finally {
            scanning.set(false);
          }
        });
  }

  private void scan() {
    Path currentRoot = root;
    Path currentRegistry = registry;
    if (currentRoot == null || currentRegistry == null || !Files.isRegularFile(currentRegistry)) {
      return;
    }

    BlueMap3DItemModelBridge currentBridge = bridge;
    if (currentBridge == null) {
      try {
        currentBridge =
            BlueMap3DItemModelBridge.open(Path.of("").toAbsolutePath().normalize(), log);
        bridge = currentBridge;
        customArmor = new CustomArmorAssetResolver(currentBridge, log);
      } catch (ClassNotFoundException error) {
        log.accept("BlueMap3D is unavailable; Player History will keep simple equipment models");
        nextScan = Long.MAX_VALUE;
        return;
      } catch (Exception error) {
        log.accept("Could not initialize BlueMap3D equipment models: " + error);
        return;
      }
    }

    try (var reader = Files.newBufferedReader(currentRegistry)) {
      JsonObject data = JsonFiles.GSON.fromJson(reader, JsonObject.class);
      JsonArray items = data == null ? null : data.getAsJsonArray("items");
      if (items == null) return;
      for (var element : items) {
        if (!element.isJsonObject()) continue;
        var key = element.getAsJsonObject().get("key");
        if (key == null || !key.isJsonPrimitive()) continue;
        String item = key.getAsString();
        if (!processed.add(item)) continue;
        publish(currentRoot, currentBridge, item);
      }
    } catch (IOException | RuntimeException error) {
      log.accept("Could not inspect Player History item registry for equipment models: " + error);
    }
  }

  private void publish(Path currentRoot, BlueMap3DItemModelBridge currentBridge, String item) {
    ResourceLocation id = ResourceLocation.tryParse(item);
    if (id == null) return;
    publishItemModel(currentRoot, currentBridge, item, id);
    publishArmor(currentRoot, currentBridge, item, id);
  }

  private void publishItemModel(
      Path currentRoot,
      BlueMap3DItemModelBridge currentBridge,
      String item,
      ResourceLocation id) {
    List<BlueMap3DItemModelBridge.Quad> quads = currentBridge.model(item);
    if (quads.isEmpty()) return;

    var groups = new LinkedHashMap<GroupKey, GroupBuilder>();
    for (var quad : quads) {
      GroupKey key = new GroupKey(quad.texture(), quad.tint());
      groups.computeIfAbsent(key, ignored -> new GroupBuilder()).add(quad);
    }

    var output = new ArrayList<ModelGroup>();
    try {
      for (var entry : groups.entrySet()) {
        ResourceLocation textureId = ResourceLocation.tryParse(entry.getKey().texture());
        String texturePath = null;
        if (textureId != null) {
          BufferedImage image = currentBridge.texture(entry.getKey().texture());
          if (image != null) {
            texturePath =
                "textures/"
                    + textureId.getNamespace()
                    + "/"
                    + textureId.getPath()
                    + ".png";
            writePng(currentRoot, texturePath, image);
          }
        }
        GroupBuilder group = entry.getValue();
        output.add(
            new ModelGroup(
                texturePath,
                entry.getKey().tint() & 0xFFFFFF,
                group.positions(),
                group.uvs()));
      }

      Path target =
          safeResolve(
              currentRoot,
              "models/" + id.getNamespace() + "/" + id.getPath() + ".json");
      Files.createDirectories(target.getParent());
      writeAtomic(
          target,
          JsonFiles.GSON.toJson(
              new ItemModel(FORMAT, item, output, fingerprint(item, output))));
    } catch (IOException error) {
      log.accept("Could not publish equipment model " + item + ": " + error);
      processed.remove(item);
    }
  }

  private void publishArmor(
      Path currentRoot,
      BlueMap3DItemModelBridge currentBridge,
      String item,
      ResourceLocation id) {
    var registered = BuiltInRegistries.ITEM.get(id);
    CustomArmorAssetResolver resolver = customArmor;
    CustomArmorAssetResolver.Model custom =
        registered instanceof Equipable && resolver != null ? resolver.resolve(id) : null;
    if (custom != null) {
      publishCustomArmor(currentRoot, currentBridge, item, id, custom);
      return;
    }

    if (!(registered instanceof ArmorItem armor)) return;
    boolean inner = armor.getType() == ArmorItem.Type.LEGGINGS;
    var layers = armor.getMaterial().value().layers();
    if (layers.isEmpty()) {
      CustomArmorAssetResolver.LayeredModel layered =
          resolver == null ? null : resolver.resolveLayered(id, armor.getType());
      if (layered != null) {
        publishLayeredArmor(currentRoot, currentBridge, item, id, layered);
      }
      return;
    }

    try {
      var published = new ArrayList<ArmorLayer>();
      for (var layer : layers) {
        ResourceLocation textureFile = layer.texture(inner);
        String texture = textureId(textureFile);
        BufferedImage image = currentBridge.texture(texture);
        if (image == null) continue;
        String path = texturePath(texture);
        writePng(currentRoot, path, image);

        published.add(new ArmorLayer(path, null, layer.dyeable(), null, null));
      }
      if (published.isEmpty()) return;
      writeArmorDescriptor(
          currentRoot,
          id,
          new ArmorModel(ARMOR_FORMAT, item, "layers", inner ? 2 : 1, published, null, null));
    } catch (IOException error) {
      log.accept("Could not publish armor textures for " + item + ": " + error);
      processed.remove(item);
    }
  }


  private void publishLayeredArmor(
      Path currentRoot,
      BlueMap3DItemModelBridge currentBridge,
      String item,
      ResourceLocation id,
      CustomArmorAssetResolver.LayeredModel model) {
    try {
      var published = new ArrayList<ArmorLayer>();
      for (var layer : model.layers()) {
        BufferedImage image = currentBridge.texture(layer.texture());
        if (image == null) continue;
        String basePath = texturePath(layer.texture());
        writePng(currentRoot, basePath, image);

        String overlayPath = null;
        if (layer.overlayTexture() != null) {
          BufferedImage overlay = currentBridge.texture(layer.overlayTexture());
          if (overlay != null) {
            overlayPath = texturePath(layer.overlayTexture());
            writePng(currentRoot, overlayPath, overlay);
          }
        }

        published.add(
            new ArmorLayer(
                basePath,
                overlayPath,
                layer.dyeable(),
                layer.deformation(),
                layer.headDeformation()));
      }
      if (published.isEmpty()) return;
      writeArmorDescriptor(
          currentRoot,
          id,
          new ArmorModel(
              ARMOR_FORMAT, item, "layers", model.layer(), published, null, null));
    } catch (IOException error) {
      log.accept("Could not publish segmented armor textures for " + item + ": " + error);
      processed.remove(item);
    }
  }

  private void publishCustomArmor(
      Path currentRoot,
      BlueMap3DItemModelBridge currentBridge,
      String item,
      ResourceLocation id,
      CustomArmorAssetResolver.Model custom) {
    BufferedImage image = currentBridge.texture(custom.texture());
    if (image == null) return;
    try {
      String texturePath = texturePath(custom.texture());
      writePng(currentRoot, texturePath, image);
      var parts = new ArrayList<CustomArmorPart>();
      for (var part : custom.parts())
        parts.add(
            new CustomArmorPart(part.parent(), part.slot(), part.positions(), part.uvs()));
      writeArmorDescriptor(
          currentRoot,
          id,
          new ArmorModel(ARMOR_FORMAT, item, "custom", null, null, texturePath, parts));
    } catch (IOException error) {
      log.accept("Could not publish custom armor geometry for " + item + ": " + error);
      processed.remove(item);
    }
  }

  private static void writeArmorDescriptor(Path root, ResourceLocation id, ArmorModel model)
      throws IOException {
    Path target =
        safeResolve(root, "armor/" + id.getNamespace() + "/" + id.getPath() + ".json");
    Files.createDirectories(target.getParent());
    writeAtomic(target, JsonFiles.GSON.toJson(model));
  }


  private static String textureId(ResourceLocation file) {
    String path = file.getPath();
    if (path.startsWith("textures/")) path = path.substring("textures/".length());
    if (path.endsWith(".png")) path = path.substring(0, path.length() - ".png".length());
    return file.getNamespace() + ":" + path;
  }

  private static String texturePath(String texture) throws IOException {
    ResourceLocation id = ResourceLocation.tryParse(texture);
    if (id == null) throw new IOException("Invalid armor texture id: " + texture);
    return "textures/" + id.getNamespace() + "/" + id.getPath() + ".png";
  }

  private static void writePng(Path root, String relative, BufferedImage image) throws IOException {
    Path target = safeResolve(root, relative);
    Files.createDirectories(target.getParent());
    Path temp = Files.createTempFile(target.getParent(), ".equipment-texture-", ".tmp");
    try {
      try (var output = Files.newOutputStream(temp)) {
        if (!ImageIO.write(image, "PNG", output)) throw new IOException("No PNG writer available");
      }
      replace(temp, target);
    } finally {
      Files.deleteIfExists(temp);
    }
  }

  private static void writeAtomic(Path target, String content) throws IOException {
    Path temp = Files.createTempFile(target.getParent(), ".equipment-model-", ".tmp");
    try {
      Files.writeString(temp, content, StandardCharsets.UTF_8);
      replace(temp, target);
    } finally {
      Files.deleteIfExists(temp);
    }
  }

  private static void replace(Path source, Path target) throws IOException {
    try {
      Files.move(
          source,
          target,
          StandardCopyOption.REPLACE_EXISTING,
          StandardCopyOption.ATOMIC_MOVE);
    } catch (AtomicMoveNotSupportedException ignored) {
      Files.move(source, target, StandardCopyOption.REPLACE_EXISTING);
    }
  }

  private static Path safeResolve(Path root, String relative) throws IOException {
    Path target = root.resolve(relative).toAbsolutePath().normalize();
    if (!target.startsWith(root)) throw new IOException("Unsafe equipment asset path: " + relative);
    return target;
  }

  private static String fingerprint(String item, List<ModelGroup> groups) {
    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      digest.update(item.getBytes(StandardCharsets.UTF_8));
      digest.update(JsonFiles.GSON.toJson(groups).getBytes(StandardCharsets.UTF_8));
      return HexFormat.of().formatHex(digest.digest(), 0, 8);
    } catch (NoSuchAlgorithmException impossible) {
      return "unknown";
    }
  }

  private record GroupKey(String texture, int tint) {}

  private record ArmorLayer(
      String texture,
      String overlayTexture,
      boolean dyeable,
      Float deformation,
      Float headDeformation) {}

  private record CustomArmorPart(String parent, String slot, float[] positions, float[] uvs) {}

  private record ArmorModel(
      int format,
      String item,
      String kind,
      Integer layer,
      List<ArmorLayer> layers,
      String texture,
      List<CustomArmorPart> parts) {}

  private record ItemModel(int format, String item, List<ModelGroup> groups, String fingerprint) {}

  private record ModelGroup(String texture, int tint, float[] positions, float[] uvs) {}

  private static final class GroupBuilder {
    private final ArrayList<Float> positions = new ArrayList<>();
    private final ArrayList<Float> uvs = new ArrayList<>();

    void add(BlueMap3DItemModelBridge.Quad quad) {
      int[] triangles = {0, 1, 2, 0, 2, 3};
      for (int vertex : triangles) {
        int p = vertex * 3;
        positions.add((quad.positions()[p] - 8f) / 16f);
        positions.add((quad.positions()[p + 1] - 8f) / 16f);
        positions.add((quad.positions()[p + 2] - 8f) / 16f);
        int uv = vertex * 2;
        uvs.add(quad.uvs()[uv] / 16f);
        uvs.add(1f - quad.uvs()[uv + 1] / 16f);
      }
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
