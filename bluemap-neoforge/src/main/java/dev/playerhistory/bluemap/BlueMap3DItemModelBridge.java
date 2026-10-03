package dev.playerhistory.bluemap;

import dev.playerhistory.core.LogSink;

import java.awt.image.BufferedImage;
import java.io.IOException;
import java.lang.reflect.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import net.minecraft.resources.ResourceLocation;

/**
 * Optional reflection bridge to the patched BlueMap3D resource-model pipeline.
 *
 * <p>Player History deliberately does not take a compile-time BlueMap3D dependency. When
 * BlueMap3D is present, this bridge creates its ordinary resource index and asks
 * ResourcePackSource for named item models. That keeps resource-pack precedence, JSON parent
 * resolution, generated/handheld sprite extrusion and OBJ handling in one place.
 */
final class BlueMap3DItemModelBridge implements AutoCloseable {
  record Quad(float[] positions, float[] uvs, String texture, int tint) {}

  private static final Pattern DATA_PATH =
      Pattern.compile(
          "^\\s*data\\s*:\\s*(?:\"([^\"]+)\"|'([^']+)'|([^\\s#]+))\\s*(?:#.*)?$");

  private final Object assets;
  private final Object models;
  private final Method quadsForModel;
  private final Method texture;
  private final Method readAsset;
  private final LogSink log;

  private Method positions;
  private Method uvs;
  private Method textureId;
  private Method tint;

  private BlueMap3DItemModelBridge(
      Object assets,
      Object models,
      Method quadsForModel,
      Method texture,
      Method readAsset,
      LogSink log) {
    this.assets = assets;
    this.models = models;
    this.quadsForModel = quadsForModel;
    this.texture = texture;
    this.readAsset = readAsset;
    this.log = log;
  }

  static BlueMap3DItemModelBridge open(Path serverRoot, LogSink log) throws Exception {
    Class<?> indexType = Class.forName("dev.duzo.bluemap3d.bake.AssetIndex");
    Method open =
        Arrays.stream(indexType.getDeclaredMethods())
            .filter(method -> method.getName().equals("open") && method.getParameterCount() == 2)
            .findFirst()
            .orElseThrow(() -> new NoSuchMethodException("AssetIndex.open"));
    open.setAccessible(true);

    Path blueMapRoot = blueMapDataRoot(serverRoot);
    Object assets = open.invoke(null, List.of(), blueMapRoot);

    Class<?> sourceType = Class.forName("dev.duzo.bluemap3d.bake.ResourcePackSource");
    Constructor<?> constructor =
        Arrays.stream(sourceType.getDeclaredConstructors())
            .filter(candidate -> candidate.getParameterCount() == 1)
            .findFirst()
            .orElseThrow(() -> new NoSuchMethodException("ResourcePackSource constructor"));
    constructor.setAccessible(true);
    Object models = constructor.newInstance(assets);

    Method quadsForModel =
        Arrays.stream(sourceType.getMethods())
            .filter(
                method ->
                    method.getName().equals("quadsForModel") && method.getParameterCount() == 2)
            .findFirst()
            .orElseThrow(() -> new NoSuchMethodException("ResourcePackSource.quadsForModel"));
    Method texture = sourceType.getMethod("texture", String.class);
    Method readAsset = indexType.getMethod("read", String.class);

    log.info("Player equipment models connected to BlueMap3D resource packs at " + blueMapRoot);
    return new BlueMap3DItemModelBridge(
        assets, models, quadsForModel, texture, readAsset, log);
  }

  List<Quad> model(String itemId) {
    ResourceLocation item = ResourceLocation.tryParse(itemId);
    if (item == null) return List.of();
    ResourceLocation model =
        ResourceLocation.tryParse(item.getNamespace() + ":item/" + item.getPath());
    if (model == null) return List.of();

    try {
      Object value = quadsForModel.invoke(models, model, Map.of());
      if (!(value instanceof List<?> raw) || raw.isEmpty()) return List.of();
      var result = new ArrayList<Quad>(raw.size());
      for (Object quad : raw) {
        if (quad == null) continue;
        ensureQuadAccessors(quad.getClass());
        float[] p = (float[]) positions.invoke(quad);
        float[] uv = (float[]) uvs.invoke(quad);
        String textureName = String.valueOf(textureId.invoke(quad));
        int tintValue = ((Number) tint.invoke(quad)).intValue();
        if (p.length == 12 && uv.length == 8) {
          result.add(new Quad(p.clone(), uv.clone(), textureName, tintValue));
        }
      }
      return List.copyOf(result);
    } catch (ReflectiveOperationException | RuntimeException error) {
      log.warn("Could not resolve equipment model " + itemId + ": " + rootCause(error));
      return List.of();
    }
  }

  byte[] asset(String path) {
    try {
      Object value = readAsset.invoke(assets, path);
      return value instanceof byte[] bytes ? bytes.clone() : null;
    } catch (ReflectiveOperationException | RuntimeException error) {
      return null;
    }
  }

  BufferedImage texture(String id) {
    try {
      Object value = texture.invoke(models, id);
      return value instanceof BufferedImage image ? image : null;
    } catch (ReflectiveOperationException | RuntimeException error) {
      return null;
    }
  }

  private void ensureQuadAccessors(Class<?> type) throws NoSuchMethodException {
    if (positions != null && positions.getDeclaringClass().equals(type)) return;
    positions = accessible(type.getDeclaredMethod("positions"));
    uvs = accessible(type.getDeclaredMethod("uvs"));
    textureId = accessible(type.getDeclaredMethod("texture"));
    tint = accessible(type.getDeclaredMethod("tint"));
  }

  private static Method accessible(Method method) {
    method.setAccessible(true);
    return method;
  }

  private static Path blueMapDataRoot(Path serverRoot) {
    Path config = serverRoot.resolve("config").resolve("bluemap").resolve("core.conf");
    if (Files.isRegularFile(config)) {
      try {
        for (String line : Files.readAllLines(config, StandardCharsets.UTF_8)) {
          Matcher matcher = DATA_PATH.matcher(line);
          if (!matcher.matches()) continue;
          String value =
              matcher.group(1) != null
                  ? matcher.group(1)
                  : matcher.group(2) != null ? matcher.group(2) : matcher.group(3);
          if (value == null || value.contains("$" + "{")) break;
          Path configured = Path.of(value.replace("\\\\", "\\"));
          return (configured.isAbsolute() ? configured : serverRoot.resolve(configured))
              .toAbsolutePath()
              .normalize();
        }
      } catch (IOException | RuntimeException ignored) {
      }
    }
    return serverRoot.resolve("bluemap").toAbsolutePath().normalize();
  }

  private static String rootCause(Throwable error) {
    Throwable current = error;
    while (current instanceof InvocationTargetException invocation && invocation.getCause() != null) {
      current = invocation.getCause();
    }
    return current.toString();
  }

  @Override
  public void close() {
    if (assets instanceof AutoCloseable closeable) {
      try {
        closeable.close();
      } catch (Exception error) {
        log.warn("Could not close BlueMap3D equipment resource index: " + error);
      }
    }
  }
}
