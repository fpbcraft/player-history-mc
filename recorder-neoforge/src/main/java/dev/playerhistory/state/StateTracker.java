package dev.playerhistory.state;

import java.util.*;

/** State contains only enabled fields. Removed fields become explicit unknown values. */
public final class StateTracker {
  private record Previous(long checkpoint, long bucket, Map<String, Object> values) {}

  private final Map<Integer, Previous> players = new HashMap<>();

  public StateRecord update(
      int player, long time, long chunk, long interval, Map<String, Object> values) {
    var prior = players.get(player);
    long bucket = Math.floorDiv(time, chunk);
    boolean checkpoint =
        prior == null || prior.bucket != bucket || time - prior.checkpoint >= interval;
    Map<String, Object> delta = new LinkedHashMap<>();
    if (checkpoint) delta.putAll(values);
    else {
      values.forEach(
          (key, value) -> {
            if (!Objects.equals(value, prior.values.get(key))) delta.put(key, value);
          });
      prior.values.keySet().stream()
          .filter(key -> !values.containsKey(key))
          .forEach(key -> delta.put(key, null));
    }
    players.put(
        player,
        new Previous(checkpoint ? time : prior.checkpoint, bucket, new LinkedHashMap<>(values)));
    return !checkpoint && delta.isEmpty()
        ? null
        : new StateRecord(player, time, checkpoint ? "checkpoint" : "delta", delta);
  }

  public StateRecord end(int player, long time) {
    players.remove(player);
    return new StateRecord(player, time, "unknown", Map.of());
  }

  public void reset(int player) {
    players.remove(player);
  }
}
