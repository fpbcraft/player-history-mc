package dev.playerhistory.core;

/** Immutable, fixed-point snapshot. Flags describe arrival at this point. */
public record Point(int player, long time, int world, int x, int y, int z, int flags) {
  public static final int BREAK = 1, OFFLINE = 2, HOLD = 4, CONTEXT = 8;

  public static Point at(
      int player, long time, int world, double x, double y, double z, int flags) {
    return new Point(player, time, world, fixed(x), fixed(y), fixed(z), flags);
  }

  private static int fixed(double n) {
    if (!Double.isFinite(n) || Math.abs(n) > 60_000_000)
      throw new IllegalArgumentException("Coordinate out of range");
    return (int) Math.round(n * 32);
  }

  public Point with(long time, int flags) {
    return new Point(player, time, world, x, y, z, flags);
  }

  public boolean online() {
    return (flags & OFFLINE) == 0;
  }

  public boolean connects(Point next) {
    return online() && next.world == world && (next.flags & BREAK) == 0;
  }
}
