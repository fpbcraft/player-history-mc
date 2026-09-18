package dev.playerhistory.bluemap;

import dev.playerhistory.object.ObjectHistoryApi;
import dev.playerhistory.object.ObjectSnapshot;
import java.lang.reflect.Method;
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
  private final Consumer<String> log;
  private boolean resolutionAttempted;
  private boolean connectedLogged;
  private long nextSample;

  private Method providersMethod;
  private Method providerIdMethod;
  private Method providerObjectsMethod;
  private Method objectIdMethod;
  private Method objectLabelMethod;
  private Method objectDimensionMethod;
  private Method objectGeometryVersionMethod;
  private Method objectPositionMethod;
  private Method objectRotationMethod;

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
    try {
      Collection<?> providers = (Collection<?>) providersMethod.invoke(null);
      for (Object provider : providers) {
        String providerId = (String) providerIdMethod.invoke(provider);
        if (!allow.contains(providerId)) continue;

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
        log.accept("BlueMap3D object-history bridge active for providers " + allow);
      }
    } catch (ReflectiveOperationException | RuntimeException error) {
      log.accept("Cannot sample BlueMap3D object history: " + rootCause(error));
    }
  }

  void reset() {
    nextSample = 0;
  }

  private ObjectSnapshot snapshot(Object object) throws ReflectiveOperationException {
    String sourceId = (String) objectIdMethod.invoke(object);
    String label = (String) objectLabelMethod.invoke(object);
    @SuppressWarnings("unchecked")
    ResourceKey<Level> dimension = (ResourceKey<Level>) objectDimensionMethod.invoke(object);
    long geometryVersion = ((Number) objectGeometryVersionMethod.invoke(object)).longValue();
    Vec3 position = (Vec3) objectPositionMethod.invoke(object);
    Quaternionf rotation = (Quaternionf) objectRotationMethod.invoke(object);

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
        geometryVersion);
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
      objectIdMethod = object.getMethod("id");
      objectLabelMethod = object.getMethod("label");
      objectDimensionMethod = object.getMethod("dimension");
      objectGeometryVersionMethod = object.getMethod("geometryVersion");
      objectPositionMethod = object.getMethod("position");
      objectRotationMethod = object.getMethod("rotation");
      return true;
    } catch (ReflectiveOperationException error) {
      log.accept("BlueMap3D is not available; vehicle/object history is inactive.");
      return false;
    }
  }

  private static String rootCause(Throwable error) {
    Throwable cause = error;
    while (cause.getCause() != null) cause = cause.getCause();
    return cause.toString();
  }
}
