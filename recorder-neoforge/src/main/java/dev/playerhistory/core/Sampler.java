package dev.playerhistory.core;

import java.util.*;
import java.util.function.Consumer;

/** Server-thread owned. Captures the first stationary observation and departure anchor. */
public final class Sampler {
  private record State(Point last, Point observed, boolean moving) {}

  private final Map<Integer, State> states = new HashMap<>();
  private final double threshold;
  private final long keyframe;
  public long recorded, skipped;

  public Sampler(double threshold, long keyframe) {
    this.threshold = threshold * 32;
    this.keyframe = keyframe;
  }

  public void reset(int id) {
    states.remove(id);
  }

  public void sample(Point p, Consumer<Point> sink) {
    State s = states.get(p.player());
    if (s == null || s.last.world() != p.world() || (p.flags() & Point.BREAK) != 0) {
      emit(p.with(p.time(), p.flags() | Point.BREAK), sink);
      states.put(p.player(), new State(p, p, false));
      return;
    }
    double distance =
        Math.sqrt(
            Math.pow((double) p.x() - s.observed.x(), 2)
                + Math.pow((double) p.y() - s.observed.y(), 2)
                + Math.pow((double) p.z() - s.observed.z(), 2));
    double accumulated =
        Math.sqrt(
            Math.pow((double) p.x() - s.last.x(), 2)
                + Math.pow((double) p.y() - s.last.y(), 2)
                + Math.pow((double) p.z() - s.last.z(), 2));
    boolean moving = distance > 0;
    Point last = s.last;
    if (moving && !s.moving) {
      emit(s.observed.with(s.observed.time(), Point.HOLD), sink);
      last = s.observed;
    }
    if (accumulated >= threshold || (!moving && s.moving) || p.time() - last.time() >= keyframe) {
      emit(p.with(p.time(), moving ? 0 : Point.HOLD), sink);
      last = p;
    } else skipped++;
    states.put(p.player(), new State(last, p, moving));
  }

  private void emit(Point p, Consumer<Point> sink) {
    sink.accept(p);
    recorded++;
  }
}
