package dev.playerhistory.core;

public final class VisibilityPolicy {
  public enum Provider {
    ABSENT,
    VISIBLE,
    HIDDEN,
    UNAVAILABLE
  }

  public static boolean allow(
      boolean excluded, boolean respectHidden, boolean invisible, Provider provider) {
    if (excluded) return false;
    return !respectHidden
        || (!invisible && (provider == Provider.ABSENT || provider == Provider.VISIBLE));
  }
}
