package dev.diorama.api;

import java.nio.file.Path;
import java.util.List;

/** Optional API fixture: tests do not need a running Minecraft server or Diorama JAR. */
public final class WebVehicleScene {
  public record Vehicle(String provider, String sourceId, String label, String dimension, long version,
      double x, double y, double z, double qx, double qy, double qz, double qw, Path sprite, Path atlas) {}
  public record Snapshot(long time, List<Vehicle> vehicles) {}
  public static Snapshot snapshot = new Snapshot(0, List.of());
  public static boolean enabled = true;
  public static int interval = 500;
  public static Snapshot latest() { return snapshot; }
  public static boolean historyEnabled() { return enabled; }
  public static int historyIntervalMs() { return interval; }
}
