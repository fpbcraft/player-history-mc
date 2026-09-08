package dev.playerhistory.core;

/** Extensible type and bounded JSON payload. Coordinates use the Point scale. */
public record HistoryEvent(Point point, String type, String payload) {
  public HistoryEvent {
    if (type == null || type.length() > 64 || payload == null || payload.length() > 2048)
      throw new IllegalArgumentException("Event exceeds limits");
  }
}
