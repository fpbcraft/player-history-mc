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
import net.minecraft.resources.ResourceLocation;

/**
 * Publishes resolved resource models only for item ids that have actually appeared in
 * Player History's registry.
 *
 * <p>Descriptors contain expanded triangles in centered one-block model space and direct
 * normalized UVs, so the browser only needs BufferGeometry plus the named texture.
 */
final class EquipmentAssetPublisher {
  private static final int FORMAT = 1;
  private static final long SCAN_INTERVAL_MS = 30_000;

  private final Consumer<String> log;
  private final ExecutorService worker;
  private final AtomicBoolean scanning = new AtomicBoolean();
  private final Set<String> processed = ConcurrentHashMap.newKeySet();

  private volatile Path root;
  private volatile Path registry;
  private volatile BlueMap3DItemModelBridge bridge;
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
