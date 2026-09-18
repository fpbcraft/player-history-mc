package dev.playerhistory.object;

import dev.playerhistory.core.JsonFiles;
import java.io.*;
import java.nio.channels.FileChannel;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;

/**
 * Generic moving-object history, independent of any particular vehicle mod.
 *
 * <p>Producers submit complete snapshots per BlueMap3D provider. Sampling and registry
 * allocation happen on the server thread; all file IO stays on one background writer.
 */
public final class ObjectHistoryRecorder implements AutoCloseable {
  public record Options(
      long duration,
      int retentionDays,
      int queueCapacity,
      double minimumMovement,
      double minimumRotationDegrees,
      long keyframeMs) {
    public Options {
      if (duration < 60_000
          || 3_600_000 % duration != 0
          || retentionDays < -1
          || queueCapacity < 1
          || minimumMovement < 0
          || minimumRotationDegrees < 0
          || keyframeMs < 1000)
        throw new IllegalArgumentException("Invalid object-history options");
    }
  }

  private static final long LIVE_WINDOW_MS = 300_000;
  private static final int LIVE_POINT_LIMIT = 50_000;

  private static final class Tracked {
    ObjectSnapshot observed;
    ObjectSnapshot emittedSnapshot;
    ObjectPoint emitted;
    long lastWritten;

    Tracked(ObjectSnapshot observed) {
      this.observed = observed;
    }
  }

  private record Envelope(List<ObjectPoint> points) {}

  private final Path root;
  private final ObjectRegistry registry;
  private final Options options;
  private final Consumer<String> log;
  private final ArrayBlockingQueue<Envelope> queue;
  private final Thread worker;
  private final Map<String, Map<String, Tracked>> tracked = new HashMap<>();
  private final Set<String> forceBreak = new HashSet<>();

  private final Map<Integer, ObjectPoint> last = new HashMap<>();
  private final ArrayList<ObjectPoint> points = new ArrayList<>();
  private final ArrayList<ObjectPoint> pending = new ArrayList<>();
  private final ArrayDeque<ObjectPoint> live = new ArrayDeque<>();
  private final NavigableSet<Long> publishedChunks = new TreeSet<>();
  private final ArrayDeque<Path> backfill = new ArrayDeque<>();

  private volatile boolean running = true;
  private volatile Throwable failure;
  private volatile Path publicRoot;
  private Path backfillRoot;
  private FileChannel channel;
  private long start = -1;
  private long earliest = Long.MAX_VALUE, latest;
  private long lastFlush, lastLiveFlush, lastMaintenance;
  private volatile int retentionDays;

  public final AtomicLong written = new AtomicLong();
  public final AtomicLong dropped = new AtomicLong();
  public final AtomicLong skipped = new AtomicLong();
  public final AtomicLong bytes = new AtomicLong();

  public ObjectHistoryRecorder(Path root, Options options, Consumer<String> log) throws IOException {
    this.root = root;
    this.options = options;
    this.log = log;
    this.retentionDays = options.retentionDays();
    this.queue = new ArrayBlockingQueue<>(options.queueCapacity());

    Files.createDirectories(root.resolve("tracks"));
    Path settings = root.resolve("settings.json");
    if (Files.exists(settings)) {
      try (var reader = Files.newBufferedReader(settings)) {
        long storedDuration = JsonFiles.GSON.fromJson(reader, long.class);
        if (storedDuration != options.duration())
          throw new IOException(
              "Object-history chunk duration changed; archive this dataset before changing it");
      }
    }
    JsonFiles.write(settings, options.duration());

    registry = new ObjectRegistry(root.resolve("registry.json"));
    recover();
    indexExisting();

    worker = new Thread(this::run, "player-history-object-writer");
    worker.setDaemon(true);
    worker.start();
  }

  /**
   * Submits the complete visible set for one provider.
   *
   * <p>If a provider fails to enumerate, the bridge should not call this method. That way
   * a transient provider error cannot turn every known object into an OFFLINE sample.
   */
  public synchronized void providerSnapshot(
      String provider, Collection<ObjectSnapshot> snapshots, long now) {
    if (!running || failure != null || provider == null || provider.isBlank()) return;

    Map<String, Tracked> known = tracked.computeIfAbsent(provider, ignored -> new HashMap<>());
    Set<String> present = new HashSet<>();
    List<ObjectPoint> output = new ArrayList<>();
    Map<String, ObjectPoint> emitted = new HashMap<>();
    Map<String, ObjectSnapshot> emittedSnapshots = new HashMap<>();
    boolean breakAll = forceBreak.contains(provider);

    for (ObjectSnapshot snapshot : snapshots) {
      if (!present.add(snapshot.sourceId())) continue;
      Tracked state = known.computeIfAbsent(snapshot.sourceId(), ignored -> new Tracked(snapshot));
      state.observed = snapshot;

      int object = registry.object(provider, snapshot.sourceId(), snapshot.label());
      int world = registry.world(snapshot.world());
      int flags = breakAll || state.emitted == null || state.emitted.world() != world
          ? ObjectPoint.BREAK
          : 0;
      ObjectPoint point = ObjectPoint.at(object, now, world, snapshot, flags);

      boolean changed =
          state.emitted == null
              || state.emitted.world() != world
              || state.emitted.geometry() != point.geometry()
              || moved(state.emittedSnapshot, snapshot)
              || rotated(state.emittedSnapshot, snapshot)
              || now - state.lastWritten >= options.keyframeMs()
              || breakAll;
      if (changed) {
        output.add(point);
        emitted.put(snapshot.sourceId(), point);
        emittedSnapshots.put(snapshot.sourceId(), snapshot);
      } else {
        skipped.incrementAndGet();
      }
    }

    List<String> disappeared = new ArrayList<>();
    for (var entry : known.entrySet()) {
      if (present.contains(entry.getKey())) continue;
      Tracked state = entry.getValue();
      disappeared.add(entry.getKey());
      if (state.emitted != null) {
        int world = registry.world(state.observed.world());
        int object = registry.object(provider, entry.getKey(), state.observed.label());
        output.add(
            ObjectPoint.at(
                object,
                now,
                world,
                state.observed,
                ObjectPoint.OFFLINE | ObjectPoint.BREAK));
      }
    }

    if (output.isEmpty()) return;
    if (!queue.offer(new Envelope(List.copyOf(output)))) {
      dropped.incrementAndGet();
      forceBreak.add(provider);
      return;
    }

    forceBreak.remove(provider);
    for (var entry : emitted.entrySet()) {
      Tracked state = known.get(entry.getKey());
      if (state != null) {
        state.emitted = entry.getValue();
        state.emittedSnapshot = emittedSnapshots.get(entry.getKey());
        state.lastWritten = now;
      }
    }
    disappeared.forEach(known::remove);
  }

  public void publishTo(Path publicDatasetRoot) {
    publicRoot = publicDatasetRoot.resolve("objects");
  }

  public void retentionDays(int days) {
    if (days < -1) throw new IllegalArgumentException("Invalid retention");
    retentionDays = days;
  }

  public String stats() {
    return "objectsWritten="
        + written
        + " objectSkipped="
        + skipped
        + " objectDropped="
        + dropped
        + " objectQueue="
        + queue.size()
        + " objectBytes="
        + bytes
        + " objectFailure="
        + failure;
  }

  private boolean moved(ObjectSnapshot a, ObjectSnapshot b) {
    if (a == null) return true;
    double dx = b.x() - a.x(), dy = b.y() - a.y(), dz = b.z() - a.z();
    double minimum = options.minimumMovement();
    return dx * dx + dy * dy + dz * dz >= minimum * minimum;
  }

  private boolean rotated(ObjectSnapshot a, ObjectSnapshot b) {
    if (a == null) return true;
    double al =
        Math.sqrt(
            (double) a.qx() * a.qx()
                + (double) a.qy() * a.qy()
                + (double) a.qz() * a.qz()
                + (double) a.qw() * a.qw());
    double bl =
        Math.sqrt(
            (double) b.qx() * b.qx()
                + (double) b.qy() * b.qy()
                + (double) b.qz() * b.qz()
                + (double) b.qw() * b.qw());
    if (al < 1e-8 || bl < 1e-8) return true;
    double dot =
        Math.abs(
            ((double) a.qx() * b.qx()
                    + (double) a.qy() * b.qy()
                    + (double) a.qz() * b.qz()
                    + (double) a.qw() * b.qw())
                / (al * bl));
    dot = Math.max(-1, Math.min(1, dot));
    return Math.toDegrees(2 * Math.acos(dot)) >= options.minimumRotationDegrees();
  }

  private void run() {
    try {
      while (running || !queue.isEmpty()) {
        Envelope envelope = queue.poll(200, TimeUnit.MILLISECONDS);
        if (envelope != null) for (ObjectPoint point : envelope.points()) append(point);

        long now = System.currentTimeMillis();
        if (now - lastLiveFlush >= 250) publishLive(now);
        if (now - lastFlush >= 5000 || pending.size() >= 4096) {
          flush();
          lastFlush = now;
        }
        backfill();
        if (now - lastMaintenance >= 3_600_000) {
          retention(now);
          lastMaintenance = now;
        }
      }

      for (ObjectPoint point : List.copyOf(last.values()))
        if (point.online()) append(point.with(Math.max(point.time(), System.currentTimeMillis()),
            ObjectPoint.OFFLINE | ObjectPoint.BREAK));
      flush();
      finish();
    } catch (Throwable error) {
      failure = error;
      log.accept("Object-history writer stopped after failure: " + error);
      try {
        if (channel != null) channel.close();
      } catch (IOException ignored) {
      }
    }
  }

  private void append(ObjectPoint point) throws IOException {
    ensureChunk(point.time());
    if (points.size() >= 1_000_000)
      throw new IOException("Object chunk point cap reached; increase sample interval");
    points.add(point);
    pending.add(point);
    live.addLast(point);
    last.put(point.object(), point);
    latest = Math.max(latest, point.time());
    earliest = Math.min(earliest, start);
    written.incrementAndGet();
  }

  private void ensureChunk(long time) throws IOException {
    long bucket = Math.floorDiv(time, options.duration()) * options.duration();
    if (channel != null && bucket <= start) return;

    flush();
    finish();
    start = bucket;
    points.clear();

    Path file = root.resolve("tracks/" + start + ".tmp");
    Path existing = root.resolve("tracks/" + start + ".bin");
    if (Files.exists(existing)) {
      try (var in = Files.newInputStream(existing)) {
        points.addAll(ObjectBinaryCodec.read(in).points());
      }
      Files.copy(existing, file, StandardCopyOption.REPLACE_EXISTING);
      channel = FileChannel.open(file, StandardOpenOption.WRITE, StandardOpenOption.APPEND);
    } else {
      channel = FileChannel.open(file, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
      var header = new ByteArrayOutputStream();
      ObjectBinaryCodec.header(new DataOutputStream(header), start, options.duration());
      write(header.toByteArray());
    }

    for (ObjectPoint previous : last.values()) {
      if (!previous.online()) continue;
      ObjectPoint context = previous.with(previous.time(), previous.flags() | ObjectPoint.CONTEXT);
      points.add(context);
      pending.add(context);
    }
  }

  private void flush() throws IOException {
    if (channel == null) return;

    JsonFiles.write(root.resolve("registry.json"), registry.snapshot());
    if (!pending.isEmpty()) {
      write(ObjectBinaryCodec.frame(pending, start));
      channel.force(false);
      pending.clear();
    }

    Path pub = publicRoot;
    if (pub != null) {
      Files.createDirectories(pub);
      JsonFiles.write(pub.resolve("chunks/" + start + ".json"), List.copyOf(points));
      publishedChunks.add(start);
      JsonFiles.write(pub.resolve("manifest.json"), publicManifest());
    }

    JsonFiles.write(
        root.resolve("manifest.json"),
        Map.of(
            "formatVersion",
            1,
            "earliestTimestamp",
            earliest,
            "latestTimestamp",
            latest,
            "chunkDurationMs",
            options.duration()));
  }

  private void publishLive(long now) throws IOException {
    while (!live.isEmpty()
        && (live.size() > LIVE_POINT_LIMIT || live.peekFirst().time() < now - LIVE_WINDOW_MS))
      live.removeFirst();
    Path pub = publicRoot;
    if (pub != null)
      JsonFiles.write(
          pub.resolve("live.json"),
          Map.of(
              "protocolVersion",
              1,
              "generatedAt",
              now,
              "points",
              List.copyOf(live),
              "registry",
              registry.snapshot()));
    lastLiveFlush = now;
  }

  private Map<String, Object> publicManifest() {
    var result = new LinkedHashMap<String, Object>();
    result.put("formatVersion", 1);
    result.put("protocolVersion", 1);
    result.put("generatedAt", System.currentTimeMillis());
    result.put("earliestTimestamp", earliest);
    result.put("latestTimestamp", latest);
    result.put("chunkDurationMs", options.duration());
    result.put("chunkRanges", publishedChunkRanges());
    result.put("positionScale", ObjectPoint.POSITION_SCALE);
    result.put("quaternionScale", ObjectPoint.QUATERNION_SCALE);
    result.put("registry", registry.snapshot());
    result.put("geometryArchive", false);
    return result;
  }

  private List<long[]> publishedChunkRanges() {
    var ranges = new ArrayList<long[]>();
    long first = Long.MIN_VALUE, previous = Long.MIN_VALUE;
    for (long chunk : publishedChunks) {
      if (first == Long.MIN_VALUE) first = chunk;
      else if (chunk != previous + options.duration()) {
        ranges.add(new long[] {first, previous + options.duration()});
        first = chunk;
      }
      previous = chunk;
    }
    if (first != Long.MIN_VALUE) ranges.add(new long[] {first, previous + options.duration()});
    return ranges;
  }

  private void backfill() throws IOException {
    Path pub = publicRoot;
    if (pub == null) return;
    if (!pub.equals(backfillRoot)) {
      backfillRoot = pub;
      backfill.clear();
      publishedChunks.clear();
      Path chunks = pub.resolve("chunks");
      if (Files.exists(chunks))
        try (var files = Files.list(chunks)) {
          for (Path file : files.filter(Files::isRegularFile).toList()) {
            String name = file.getFileName().toString();
            if (!name.endsWith(".json")) continue;
            try {
              publishedChunks.add(Long.parseLong(name.substring(0, name.length() - 5)));
            } catch (NumberFormatException ignored) {
            }
          }
        }
      try (var files = Files.list(root.resolve("tracks"))) {
        files.filter(path -> path.toString().endsWith(".bin")).sorted().forEach(backfill::add);
      }
      retention(System.currentTimeMillis());
    }

    if (!backfill.isEmpty()) {
      Path file = backfill.removeFirst();
      try (var in = Files.newInputStream(file)) {
        ObjectBinaryCodec.Read read = ObjectBinaryCodec.read(in);
        JsonFiles.write(pub.resolve("chunks/" + read.start() + ".json"), read.points());
        publishedChunks.add(read.start());
      } catch (IOException error) {
        log.accept("Could not publish object-history chunk " + file + ": " + error);
      }
      JsonFiles.write(pub.resolve("manifest.json"), publicManifest());
    }
  }

  private void finish() throws IOException {
    if (channel == null) return;
    channel.force(false);
    channel.close();
    channel = null;
    JsonFiles.move(
        root.resolve("tracks/" + start + ".tmp"), root.resolve("tracks/" + start + ".bin"));
  }

  private void write(byte[] data) throws IOException {
    var buffer = java.nio.ByteBuffer.wrap(data);
    while (buffer.hasRemaining()) channel.write(buffer);
    bytes.addAndGet(data.length);
  }

  private void recover() throws IOException {
    try (var files = Files.list(root.resolve("tracks"))) {
      for (Path file : files.filter(path -> path.toString().endsWith(".tmp")).toList()) {
        try {
          ObjectBinaryCodec.Read read;
          try (var in = Files.newInputStream(file)) {
            read = ObjectBinaryCodec.read(in);
          }
          try (var out = FileChannel.open(file, StandardOpenOption.WRITE)) {
            out.truncate(read.validBytes());
            out.force(false);
          }
          JsonFiles.move(file, file.resolveSibling(read.start() + ".bin"));
          log.accept("Recovered object-history chunk " + read.start());
        } catch (Exception error) {
          log.accept("Quarantined corrupt object history " + file + ": " + error);
          JsonFiles.move(file, file.resolveSibling(file.getFileName() + ".corrupt"));
        }
      }
    }
  }

  private void indexExisting() throws IOException {
    try (var files = Files.list(root.resolve("tracks"))) {
      for (Path file : files.filter(path -> path.toString().endsWith(".bin")).toList()) {
        try {
          long chunk =
              Long.parseLong(file.getFileName().toString().substring(
                  0, file.getFileName().toString().length() - 4));
          earliest = Math.min(earliest, chunk);
          latest = Math.max(latest, chunk + options.duration());
        } catch (NumberFormatException ignored) {
        }
      }
    }
    if (latest > 0) {
      Path tail = root.resolve("tracks/" + (latest - options.duration()) + ".bin");
      if (Files.exists(tail))
        try (var in = Files.newInputStream(tail)) {
          latest =
              ObjectBinaryCodec.read(in).points().stream()
                  .mapToLong(ObjectPoint::time)
                  .max()
                  .orElse(latest);
        }
    }
  }

  public void retention(long now) throws IOException {
    if (retentionDays < 0) return;
    long cutoff =
        Math.floorDiv(now - retentionDays * 86_400_000L, 86_400_000) * 86_400_000;
    prune(root.resolve("tracks"), cutoff);
    Path pub = publicRoot;
    if (pub != null) prune(pub.resolve("chunks"), cutoff);
    publishedChunks.removeIf(chunk -> chunk < cutoff);
    earliest = Math.max(earliest, cutoff);
  }

  private static void prune(Path dir, long cutoff) throws IOException {
    if (!Files.exists(dir)) return;
    try (var paths = Files.list(dir)) {
      for (Path path : paths.filter(Files::isRegularFile).toList()) {
        String name = path.getFileName().toString();
        int dot = name.indexOf('.');
        if (dot <= 0) continue;
        try {
          if (Long.parseLong(name.substring(0, dot)) < cutoff) Files.deleteIfExists(path);
        } catch (NumberFormatException ignored) {
        }
      }
    }
  }

  @Override
  public void close() {
    running = false;
    try {
      worker.join(30_000);
    } catch (InterruptedException error) {
      Thread.currentThread().interrupt();
    }
    if (worker.isAlive()) log.accept("Object-history flush still running after 30 seconds");
  }
}
