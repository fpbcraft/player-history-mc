package dev.playerhistory.object;

import java.util.List;

/**
 * One complete logical moving-object sample.
 *
 * <p>Instance groups are optional. Rigid objects keep an empty list; flexible/repeated
 * objects such as ropes and springs carry compact repeated transforms while remaining one
 * history object.
 */
public record ObjectSnapshot(
    String sourceId,
    String label,
    String world,
    double x,
    double y,
    double z,
    float qx,
    float qy,
    float qz,
    float qw,
    float sx,
    float sy,
    float sz,
    long geometryVersion,
    List<InstanceGroup> groups) {

  public record Instance(
      double x,
      double y,
      double z,
      float qx,
      float qy,
      float qz,
      float qw,
      float sx,
      float sy,
      float sz) {
    public Instance {
      if (!Double.isFinite(x) || !Double.isFinite(y) || !Double.isFinite(z))
        throw new IllegalArgumentException("instance position");
      if (!Float.isFinite(qx)
          || !Float.isFinite(qy)
          || !Float.isFinite(qz)
          || !Float.isFinite(qw))
        throw new IllegalArgumentException("instance rotation");
      if (!Float.isFinite(sx) || !Float.isFinite(sy) || !Float.isFinite(sz)
          || sx < 0 || sy < 0 || sz < 0)
        throw new IllegalArgumentException("instance scale");
    }
  }

  public record InstanceGroup(
      String id,
      long geometryVersion,
      List<Instance> instances) {
    public InstanceGroup {
      if (id == null || id.isBlank()) throw new IllegalArgumentException("instance group id");
      instances = instances == null ? List.of() : List.copyOf(instances);
    }
  }

  public ObjectSnapshot {
    if (sourceId == null || sourceId.isBlank()) throw new IllegalArgumentException("sourceId");
    if (world == null || world.isBlank()) throw new IllegalArgumentException("world");
    if (!Double.isFinite(x) || !Double.isFinite(y) || !Double.isFinite(z))
      throw new IllegalArgumentException("position");
    if (!Float.isFinite(qx)
        || !Float.isFinite(qy)
        || !Float.isFinite(qz)
        || !Float.isFinite(qw)) throw new IllegalArgumentException("rotation");
    if (!Float.isFinite(sx) || !Float.isFinite(sy) || !Float.isFinite(sz)
        || sx < 0 || sy < 0 || sz < 0) throw new IllegalArgumentException("scale");
    label = label == null || label.isBlank() ? sourceId : label;
    groups = groups == null ? List.of() : List.copyOf(groups);
  }
}
