package dev.playerhistory.object;

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
    long geometryVersion) {
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
  }
}
