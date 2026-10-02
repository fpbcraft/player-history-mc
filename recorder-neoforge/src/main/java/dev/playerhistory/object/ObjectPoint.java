package dev.playerhistory.object;

public record ObjectPoint(
    int object,
    long time,
    int world,
    int x,
    int y,
    int z,
    short qx,
    short qy,
    short qz,
    short qw,
    short sx,
    short sy,
    short sz,
    long geometry,
    int flags) {
  public static final int OFFLINE = 1, BREAK = 2, CONTEXT = 4;
  public static final int POSITION_SCALE = 32;
  public static final int QUATERNION_SCALE = 32767;
  public static final int SCALE_SCALE = 1024;

  public boolean online() {
    return (flags & OFFLINE) == 0;
  }

  public ObjectPoint with(long newTime, int newFlags) {
    return new ObjectPoint(
        object, newTime, world, x, y, z, qx, qy, qz, qw, sx, sy, sz, geometry, newFlags);
  }

  public static ObjectPoint at(
      int object, long time, int world, ObjectSnapshot snapshot, int flags) {
    double length =
        Math.sqrt(
            (double) snapshot.qx() * snapshot.qx()
                + (double) snapshot.qy() * snapshot.qy()
                + (double) snapshot.qz() * snapshot.qz()
                + (double) snapshot.qw() * snapshot.qw());
    float qx = 0, qy = 0, qz = 0, qw = 1;
    if (length > 1e-8) {
      qx = (float) (snapshot.qx() / length);
      qy = (float) (snapshot.qy() / length);
      qz = (float) (snapshot.qz() / length);
      qw = (float) (snapshot.qw() / length);
    }
    return new ObjectPoint(
        object,
        time,
        world,
        scaled(snapshot.x()),
        scaled(snapshot.y()),
        scaled(snapshot.z()),
        quantize(qx),
        quantize(qy),
        quantize(qz),
        quantize(qw),
        quantizeScale(snapshot.sx()),
        quantizeScale(snapshot.sy()),
        quantizeScale(snapshot.sz()),
        snapshot.geometryVersion(),
        flags);
  }

  private static int scaled(double value) {
    long scaled = Math.round(value * POSITION_SCALE);
    if (scaled < Integer.MIN_VALUE || scaled > Integer.MAX_VALUE)
      throw new IllegalArgumentException("Object coordinate is outside supported range: " + value);
    return (int) scaled;
  }

  private static short quantize(float value) {
    int q = Math.round(Math.max(-1f, Math.min(1f, value)) * QUATERNION_SCALE);
    return (short) q;
  }

  private static short quantizeScale(float value) {
    int q = Math.round(Math.max(0f, Math.min(Short.MAX_VALUE / (float) SCALE_SCALE, value))
        * SCALE_SCALE);
    return (short) q;
  }
}
