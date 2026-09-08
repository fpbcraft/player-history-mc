package dev.playerhistory.state;

import java.util.*;

public record StateRecord(int player, long time, String kind, Map<String, Object> values) {
  public StateRecord {
    values = Collections.unmodifiableMap(new LinkedHashMap<>(values));
  }
}
