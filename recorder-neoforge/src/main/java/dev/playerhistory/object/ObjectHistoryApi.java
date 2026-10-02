package dev.playerhistory.object;

import java.io.IOException;
import java.nio.file.Path;
import java.util.Collection;

/**
 * Small cross-module bridge used by optional integrations such as BlueMap3D.
 *
 * <p>The recorder owns the active implementation. Integrations can safely submit before
 * startup or after shutdown; those calls simply no-op.
 */
public final class ObjectHistoryApi {
  private static volatile ObjectHistoryRecorder active;

  private ObjectHistoryApi() {}

  public static void install(ObjectHistoryRecorder recorder) {
    active = recorder;
  }

  public static void clear(ObjectHistoryRecorder recorder) {
    if (active == recorder) active = null;
  }

  public static void providerSnapshot(
      String provider, Collection<ObjectSnapshot> snapshots, long now) {
    ObjectHistoryRecorder recorder = active;
    if (recorder != null) recorder.providerSnapshot(provider, snapshots, now);
  }

  public static void archiveGeometry(
      String provider,
      String sourceId,
      long version,
      Path sourceMesh,
      Path sourceAtlas)
      throws IOException {
    ObjectHistoryRecorder recorder = active;
    if (recorder != null)
      recorder.archiveGeometry(provider, sourceId, version, sourceMesh, sourceAtlas);
  }

  public static boolean available() {
    return active != null;
  }
}
