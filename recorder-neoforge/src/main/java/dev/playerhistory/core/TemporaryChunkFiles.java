package dev.playerhistory.core;

import java.io.IOException;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.List;

/** Filesystem lifecycle for recoverable temporary history chunks. */
public final class TemporaryChunkFiles {
  @FunctionalInterface
  public interface Repair {
    void apply(FileChannel channel) throws IOException;
  }

  private TemporaryChunkFiles() {}

  public static long bucketStart(long time, long duration) {
    if (duration <= 0) throw new IllegalArgumentException("Chunk duration must be positive");
    return Math.floorDiv(time, duration) * duration;
  }

  public static Path temporary(Path tracks, long start) {
    return tracks.resolve(start + ".tmp");
  }

  public static Path completed(Path tracks, long start) {
    return tracks.resolve(start + ".bin");
  }

  public static List<Path> list(Path tracks) throws IOException {
    try (var files = Files.list(tracks)) {
      return files.filter(path -> path.toString().endsWith(".tmp")).toList();
    }
  }

  public static void repair(Path file, long validBytes, Repair repair) throws IOException {
    try (var channel = FileChannel.open(file, StandardOpenOption.WRITE)) {
      channel.truncate(validBytes);
      channel.position(validBytes);
      repair.apply(channel);
      channel.force(false);
    }
  }

  public static void complete(Path file, long start) throws IOException {
    JsonFiles.move(file, completed(file.getParent(), start));
  }

  public static void quarantine(Path file) throws IOException {
    JsonFiles.move(file, file.resolveSibling(file.getFileName() + ".corrupt"));
  }
}
