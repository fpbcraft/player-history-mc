package dev.playerhistory.assets;

import com.google.gson.Gson;
import dev.playerhistory.core.LogSink;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;
import java.util.function.Consumer;

/** A single pending snapshot; slow disks cannot create an unbounded queue or block ticks. */
final class PublicSnapshotWriter implements AutoCloseable {
  record Pending(Path path, Object value) {}
  private final ExecutorService worker = Executors.newSingleThreadExecutor(task -> {
    Thread thread = new Thread(task, "player-history-public-snapshots");
    thread.setDaemon(true); return thread;
  });
  private final Consumer<Pending> write;
  private Pending pending;
  private boolean running;
  private boolean closed;

  PublicSnapshotWriter(LogSink log) {
    Gson gson = new Gson();
    write = next -> {
      try {
        Files.createDirectories(next.path().getParent());
        Path temp = next.path().resolveSibling(next.path().getFileName() + ".tmp");
        Files.writeString(temp, gson.toJson(next.value()), StandardCharsets.UTF_8);
        try { Files.move(temp, next.path(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE); }
        catch (AtomicMoveNotSupportedException ignored) { Files.move(temp, next.path(), StandardCopyOption.REPLACE_EXISTING); }
      } catch (Exception error) { log.warn("Could not publish public snapshot: " + error); }
    };
  }
  PublicSnapshotWriter(Consumer<Pending> write) { this.write = write; }

  synchronized void offer(Path path, Object value) {
    if (closed) return;
    pending = new Pending(path, value);
    if (running) return;
    running = true; worker.execute(this::drain);
  }

  private void drain() {
    while (true) {
      Pending next;
      synchronized (this) {
        next = pending; pending = null;
        if (next == null || closed) { running = false; return; }
      }
      write.accept(next);
    }
  }

  public synchronized void close() { closed = true; pending = null; worker.shutdownNow(); }
}
