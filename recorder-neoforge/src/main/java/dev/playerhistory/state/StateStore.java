package dev.playerhistory.state;

import dev.playerhistory.core.JsonFiles;
import java.io.*;
import java.nio.channels.FileChannel;
import java.nio.file.*;
import java.util.*;

/** Owned by HistoryStore's worker. At most one bounded state chunk is resident. */
public final class StateStore implements AutoCloseable {
  private final Path directory;
  private final long duration;
  private long start = -1;
  private FileChannel channel;
  private final List<byte[]> pending = new ArrayList<>();
  private final List<StateRecord> records = new ArrayList<>();

  public StateStore(Path root, long duration) throws IOException {
    directory = root.resolve("states");
    this.duration = duration;
    Files.createDirectories(directory);
    try (var files = Files.list(directory)) {
      for (Path file : files.filter(f -> f.toString().endsWith(".tmp")).toList()) {
        try (var in = Files.newInputStream(file)) {
          var read = StateCodec.read(in);
          try (var c = FileChannel.open(file, StandardOpenOption.WRITE)) {
            c.truncate(read.validBytes());
            c.position(read.validBytes());
            var active = new LinkedHashMap<Integer, Long>();
            for (var record : read.records()) {
              if (record.kind().equals("unknown")) active.remove(record.player());
              else active.put(record.player(), record.time());
            }
            for (var entry : active.entrySet()) {
              var bytes =
                  java.nio.ByteBuffer.wrap(
                      StateCodec.frame(
                          new StateRecord(entry.getKey(), entry.getValue(), "unknown", Map.of())));
              while (bytes.hasRemaining()) c.write(bytes);
            }
            c.force(false);
          }
          JsonFiles.move(
              file, file.resolveSibling(file.getFileName().toString().replace(".tmp", ".bin")));
        } catch (IOException ex) {
          JsonFiles.move(file, file.resolveSibling(file.getFileName() + ".corrupt"));
        }
      }
    }
  }

  public void append(StateRecord record) throws IOException {
    long bucket = Math.floorDiv(record.time(), duration) * duration;
    if (bucket != start || channel == null) {
      close();
      start = bucket;
      records.clear();
      Path tmp = directory.resolve(start + ".tmp"), bin = directory.resolve(start + ".bin");
      if (Files.exists(bin)) {
        try (var in = Files.newInputStream(bin)) {
          var read = StateCodec.read(in);
          if (read.partial()) throw new IOException("Corrupt finalized state chunk");
          records.addAll(read.records());
        }
        Files.copy(bin, tmp, StandardCopyOption.REPLACE_EXISTING);
      } else
        try (var out = new DataOutputStream(Files.newOutputStream(tmp))) {
          out.writeInt(StateCodec.MAGIC);
          out.writeInt(StateCodec.VERSION);
        }
      channel = FileChannel.open(tmp, StandardOpenOption.WRITE, StandardOpenOption.APPEND);
    }
    if (records.size() >= 100000) throw new IOException("State chunk record limit");
    pending.add(StateCodec.frame(record));
    records.add(record);
  }

  public void flush(Path publicRoot) throws IOException {
    if (channel != null) {
      for (byte[] frame : pending) {
        var bytes = java.nio.ByteBuffer.wrap(frame);
        while (bytes.hasRemaining()) channel.write(bytes);
      }
      pending.clear();
      channel.force(false);
      if (publicRoot != null)
        JsonFiles.write(
            publicRoot.resolve("states/" + start + ".json"),
            records.stream().sorted(Comparator.comparingLong(StateRecord::time)).toList());
    }
  }

  public void publish(Path file, Path publicRoot) throws IOException {
    try (var in = Files.newInputStream(file)) {
      JsonFiles.write(
          publicRoot.resolve("states/" + file.getFileName().toString().replace(".bin", ".json")),
          closedPrefix(StateCodec.read(in)).stream()
              .sorted(Comparator.comparingLong(StateRecord::time))
              .toList());
    }
  }

  private static List<StateRecord> closedPrefix(StateCodec.Read read) {
    if (!read.partial()) return read.records();
    var result = new ArrayList<>(read.records());
    var active = new LinkedHashMap<Integer, Long>();
    for (var record : result) {
      if (record.kind().equals("unknown")) active.remove(record.player());
      else active.put(record.player(), record.time());
    }
    active.forEach(
        (player, time) -> result.add(new StateRecord(player, time, "unknown", Map.of())));
    return result;
  }

  public void abort() throws IOException {
    pending.clear();
    if (channel != null) {
      channel.close();
      channel = null;
    }
  }

  public void close() throws IOException {
    if (channel != null) {
      flush(null);
      channel.close();
      channel = null;
      JsonFiles.move(directory.resolve(start + ".tmp"), directory.resolve(start + ".bin"));
    }
  }
}
