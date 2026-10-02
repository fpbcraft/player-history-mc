package dev.playerhistory.bluemap;

import dev.playerhistory.object.ObjectHistoryApi;
import dev.playerhistory.object.ObjectSnapshot;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.nio.file.Path;
import java.util.*;
import java.util.function.Consumer;
import net.minecraft.resources.ResourceKey;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.Level;
import net.minecraft.world.phys.Vec3;
import net.neoforged.neoforge.event.tick.ServerTickEvent;
import org.joml.Quaternionf;

/**
 * Optional BlueMap3D adapter.
 *
 * <p>BlueMap3D's public registry is deliberately tiny but sufficient: its providers
 * already normalize Create trains, Sable ships and future addons into stable scene
 * objects. This bridge samples that abstraction instead of depending on Create/Sable.
 */
final class BlueMap3DHistoryBridge {
  private static final Set<String> LEGACY_DEFAULT_PROVIDERS =
      Set.of("create_contraptions", "sable_ships");

  private final Consumer<String> log;
  private boolean resolutionAttempted;
  private boolean connectedLogged;
  private boolean legacyProviderMigrationLogged;
  private long nextSample;
  private volatile Path webRoot;
  private Object meshListener;

  private Method providersMethod;
  private Method providerIdMethod;
  private Method providerObjectsMethod;
  private Method providerLifecycleMethod;
  private Method lifecycleRecordHistoryMethod;
  private Method objectIdMethod;
  private Method objectLabelMethod;
  private Method objectDimensionMethod;
  private Method objectGeometryVersionMethod;
  private Method objectPositionMethod;
  private Method objectRotationMethod;
  private Method objectScaleMethod;

  private Class<?> instancedObjectClass;
  private Method instanceGroupsMethod;
  private Method groupIdMethod;
  private Method groupGeometryVersionMethod;
  private Method groupInstancesMethod;
  private Method instancePositionMethod;
  private Method instanceRotationMethod;
  private Method instanceScaleMethod;

  BlueMap3DHistoryBridge(Consumer<String> log) {
    this.log = log;
  }

  void tick(
      ServerTickEvent.Post event,
      boolean enabled,
      int intervalMs,
      Collection<? extends String> enabledProviders) {
    if (!enabled || !ObjectHistoryApi.available()) return;
    long now = System.currentTimeMillis();
    if (now < nextSample) return;
    nextSample = now + intervalMs;

    if (!resolve()) return;

    Set<String> allow = new HashSet<>(enabledProviders);

    // Before generic scene history, this exact pair was written into generated configs as
    // the default. NeoForge keeps that value across upgrades, so merely changing the code
    // default to an empty list does not opt existing installations into ropes, springs or
    // future recordable providers. Treat only the exact legacy default as the old implicit
    // default; any other non-empty list remains an intentional explicit allow-list.
    boolean migratedLegacyDefault = allow.equals(LEGACY_DEFAULT_PROVIDERS);
    if (migratedLegacyDefault) {
      allow.clear();
      if (!legacyProviderMigrationLogged) {
        legacyProviderMigrationLogged = true;
        log.accept(
            "Migrated legacy BlueMap3D history provider default to all recordable providers.");
      }
    }
    boolean explicitProviderList = !allow.isEmpty();
    try {
      Collection<?> providers = (Collection<?>) providersMethod.invoke(null);
      for (Object provider : providers) {
        String providerId = (String) providerIdMethod.invoke(provider);
        if (explicitProviderList) {
          if (!allow.contains(providerId)) continue;
        } else if (!recordsHistory(provider)) {
          continue;
        }

        List<ObjectSnapshot> snapshots = new ArrayList<>();
        boolean complete = true;
        for (ServerLevel level : event.getServer().getAllLevels()) {
          try {
            Iterable<?> objects = (Iterable<?>) providerObjectsMethod.invoke(provider, level);
            for (Object object : objects) snapshots.add(snapshot(object));
          } catch (ReflectiveOperationException | RuntimeException error) {
            complete = false;
            log.accept(
                "BlueMap3D provider '"
                    + providerId
                    + "' could not be sampled; preserving its previous object state: "
                    + rootCause(error));
            break;
          }
        }

        // Absence is meaningful only after a complete provider enumeration. If one
        // dimension failed, skipping the submission prevents false OFFLINE records.
        if (complete) ObjectHistoryApi.providerSnapshot(providerId, snapshots, now);
      }

      if (!connectedLogged) {
        connectedLogged = true;
        log.accept(
            explicitProviderList
                ? "BlueMap3D object-history bridge active for configured providers " + allow
                : "BlueMap3D object-history bridge active for all recordable providers");
      }
    } catch (ReflectiveOperationException | RuntimeException error) {
      log.accept("Cannot sample BlueMap3D object history: " + rootCause(error));
    }
  }

  void webRoot(Path root) {
    webRoot = root == null ? null : root.toAbsolutePath().normalize();
  }

  void reset() {
    nextSample = 0;
    webRoot = null;
  }

  private ObjectSnapshot snapshot(Object object) throws ReflectiveOperationException {
    String sourceId = (String) objectIdMethod.invoke(object);
    String label = (String) objectLabelMethod.invoke(object);
    @SuppressWarnings("unchecked")
    ResourceKey<Level> dimension = (ResourceKey<Level>) objectDimensionMethod.invoke(object);
    long geometryVersion = ((Number) objectGeometryVersionMethod.invoke(object)).longValue();
    Vec3 position = (Vec3) objectPositionMethod.invoke(object);
    Quaternionf rotation = (Quaternionf) objectRotationMethod.invoke(object);
    org.joml.Vector3f scale =
        objectScaleMethod == null
            ? new org.joml.Vector3f(1f, 1f, 1f)
            : (org.joml.Vector3f) objectScaleMethod.invoke(object);

    List<ObjectSnapshot.InstanceGroup> groups = instanceGroups(object);

    return new ObjectSnapshot(
        sourceId,
        label,
        dimension.location().toString(),
        position.x,
        position.y,
        position.z,
        rotation.x,
        rotation.y,
        rotation.z,
        rotation.w,
        scale.x,
        scale.y,
        scale.z,
        geometryVersion,
        groups);
  }

  private List<ObjectSnapshot.InstanceGroup> instanceGroups(Object object)
      throws ReflectiveOperationException {
    if (instancedObjectClass == null
        || instanceGroupsMethod == null
        || !instancedObjectClass.isInstance(object)) return List.of();

    Object value = instanceGroupsMethod.invoke(object);
    if (!(value instanceof Iterable<?> groups)) return List.of();

    List<ObjectSnapshot.InstanceGroup> result = new ArrayList<>();
    for (Object group : groups) {
      if (group == null) continue;
      String id = (String) groupIdMethod.invoke(group);
      long geometryVersion = ((Number) groupGeometryVersionMethod.invoke(group)).longValue();
      Object instancesValue = groupInstancesMethod.invoke(group);
      if (!(instancesValue instanceof Iterable<?> instances)) continue;

      List<ObjectSnapshot.Instance> snapshotInstances = new ArrayList<>();
      for (Object instance : instances) {
        if (instance == null) continue;
        Vec3 position = (Vec3) instancePositionMethod.invoke(instance);
        Quaternionf rotation = (Quaternionf) instanceRotationMethod.invoke(instance);
        org.joml.Vector3f scale =
            (org.joml.Vector3f) instanceScaleMethod.invoke(instance);
        snapshotInstances.add(
            new ObjectSnapshot.Instance(
                position.x,
                position.y,
                position.z,
                rotation.x,
                rotation.y,
                rotation.z,
                rotation.w,
                scale.x,
                scale.y,
                scale.z));
      }
      result.add(new ObjectSnapshot.InstanceGroup(id, geometryVersion, snapshotInstances));
    }
    return List.copyOf(result);
  }

  private boolean resolve() {
    if (providersMethod != null) return true;
    if (resolutionAttempted) return false;
    resolutionAttempted = true;
    try {
      Class<?> api = Class.forName("dev.duzo.bluemap3d.api.BlueMap3D");
      Class<?> provider = Class.forName("dev.duzo.bluemap3d.api.SceneObjectProvider");
      Class<?> object = Class.forName("dev.duzo.bluemap3d.api.SceneObject");

      providersMethod = api.getMethod("providers");
      providerIdMethod = provider.getMethod("id");
      providerObjectsMethod = provider.getMethod("objects", ServerLevel.class);
      try {
        providerLifecycleMethod = provider.getMethod("lifecycle");
        Class<?> lifecycle = Class.forName("dev.duzo.bluemap3d.api.SceneObjectLifecycle");
        lifecycleRecordHistoryMethod = lifecycle.getMethod("recordHistory");
      } catch (ReflectiveOperationException ignored) {
        providerLifecycleMethod = null;
        lifecycleRecordHistoryMethod = null;
      }
      objectIdMethod = object.getMethod("id");
      objectLabelMethod = object.getMethod("label");
      objectDimensionMethod = object.getMethod("dimension");
      objectGeometryVersionMethod = object.getMethod("geometryVersion");
      objectPositionMethod = object.getMethod("position");
      objectRotationMethod = object.getMethod("rotation");
      try {
        objectScaleMethod = object.getMethod("scale");
      } catch (NoSuchMethodException ignored) {
        objectScaleMethod = null;
      }

      try {
        instancedObjectClass = Class.forName("dev.duzo.bluemap3d.api.InstancedSceneObject");
        Class<?> groupClass = Class.forName("dev.duzo.bluemap3d.api.SceneInstanceGroup");
        Class<?> instanceClass = Class.forName("dev.duzo.bluemap3d.api.SceneInstance");
        instanceGroupsMethod = instancedObjectClass.getMethod("instanceGroups");
        groupIdMethod = groupClass.getMethod("id");
        groupGeometryVersionMethod = groupClass.getMethod("geometryVersion");
        groupInstancesMethod = groupClass.getMethod("instances");
        instancePositionMethod = instanceClass.getMethod("position");
        instanceRotationMethod = instanceClass.getMethod("rotation");
        instanceScaleMethod = instanceClass.getMethod("scale");
      } catch (ReflectiveOperationException ignored) {
        instancedObjectClass = null;
        instanceGroupsMethod = null;
      }

      installMeshListener(api);
      return true;
    } catch (ReflectiveOperationException error) {
      log.accept("BlueMap3D is not available; vehicle/object history is inactive.");
      return false;
    }
  }

  private boolean recordsHistory(Object provider) {
    if (providerLifecycleMethod == null || lifecycleRecordHistoryMethod == null) return true;
    try {
      Object lifecycle = providerLifecycleMethod.invoke(provider);
      return lifecycle != null && Boolean.TRUE.equals(lifecycleRecordHistoryMethod.invoke(lifecycle));
    } catch (ReflectiveOperationException | RuntimeException error) {
      log.accept("Could not read BlueMap3D provider lifecycle; recording it by default: " + rootCause(error));
      return true;
    }
  }

  private void installMeshListener(Class<?> api) {
    if (meshListener != null) return;
    try {
      Class<?> listenerType =
          Class.forName("dev.duzo.bluemap3d.api.BlueMap3D$MeshPublicationListener");
      Object listener =
          Proxy.newProxyInstance(
              listenerType.getClassLoader(),
              new Class<?>[] {listenerType},
              (proxy, method, args) -> {
                if ("published".equals(method.getName())
                    && args != null
                    && args.length == 1
                    && args[0] != null) {
                  archivePublication(args[0]);
                  return null;
                }
                if ("toString".equals(method.getName()))
                  return "PlayerHistoryBlueMap3DMeshListener";
                if ("hashCode".equals(method.getName())) return System.identityHashCode(proxy);
                if ("equals".equals(method.getName()))
                  return args != null && args.length == 1 && proxy == args[0];
                return null;
              });
      api.getMethod("addMeshPublicationListener", listenerType).invoke(null, listener);
      meshListener = listener;
      log.accept("BlueMap3D geometry archive listener active.");
    } catch (ReflectiveOperationException error) {
      log.accept(
          "BlueMap3D does not expose mesh publication events; object transforms will record, "
              + "but durable historical geometry needs the Player History BlueMap3D build.");
    }
  }

  private void archivePublication(Object publication) {
    Path root = webRoot;
    if (root == null || !ObjectHistoryApi.available()) return;
    try {
      Class<?> type = publication.getClass();
      String provider = (String) type.getMethod("provider").invoke(publication);
      String sourceId = (String) type.getMethod("objectId").invoke(publication);
      long version = ((Number) type.getMethod("version").invoke(publication)).longValue();
      String meshUrl = (String) type.getMethod("meshUrl").invoke(publication);

      Path mesh = root.resolve(meshUrl).normalize();
      if (!mesh.startsWith(root))
        throw new IllegalArgumentException("BlueMap3D mesh escaped web root: " + meshUrl);
      String atlasUrl =
          meshUrl.endsWith(".bm3d")
              ? meshUrl.substring(0, meshUrl.length() - ".bm3d".length()) + ".png"
              : meshUrl + ".png";
      Path atlas = root.resolve(atlasUrl).normalize();
      if (!atlas.startsWith(root))
        throw new IllegalArgumentException("BlueMap3D atlas escaped web root: " + atlasUrl);

      ObjectHistoryApi.archiveGeometry(provider, sourceId, version, mesh, atlas);
    } catch (Exception error) {
      log.accept("Could not archive BlueMap3D geometry: " + rootCause(error));
    }
  }

  private static String rootCause(Throwable error) {
    Throwable cause = error;
    while (cause.getCause() != null) cause = cause.getCause();
    return cause.toString();
  }
}
