package dev.playerhistory.core;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.NavigableSet;
import java.util.TreeSet;

/** Tracks published JSON chunks and exposes the compact range form used by public manifests. */
public final class PublishedChunkIndex {
  private final long duration;
  private final NavigableSet<Long> chunks = new TreeSet<>();

  public PublishedChunkIndex(long duration) {
    if (duration <= 0) throw new IllegalArgumentException("duration must be positive");
    this.duration = duration;
  }

  public void add(long start) {
    chunks.add(start);
  }

  public void clear() {
    chunks.clear();
  }

  public void removeBefore(long cutoff) {
    chunks.removeIf(start -> start < cutoff);
  }

  public List<long[]> ranges() {
    var ranges = new ArrayList<long[]>();
    long first = Long.MIN_VALUE;
    long previous = Long.MIN_VALUE;

    for (long chunk : chunks) {
      if (first == Long.MIN_VALUE) {
        first = chunk;
      } else if (chunk != previous + duration) {
        ranges.add(new long[] {first, previous + duration});
        first = chunk;
      }
      previous = chunk;
    }

    if (first != Long.MIN_VALUE) {
      ranges.add(new long[] {first, previous + duration});
    }
    return ranges;
  }

  public void indexJsonDirectory(Path directory) throws IOException {
    clear();
    if (!Files.exists(directory)) return;

    try (var files = Files.list(directory)) {
      for (Path file : files.filter(Files::isRegularFile).toList()) {
        String name = file.getFileName().toString();
        if (!name.endsWith(".json")) continue;
        try {
          add(Long.parseLong(name.substring(0, name.length() - 5)));
        } catch (NumberFormatException ignored) {
        }
      }
    }
  }
}
