package dev.playerhistory.core;

import dev.playerhistory.state.*;
import java.io.*;
import java.nio.channels.FileChannel;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import java.util.function.*;

/** One worker owns all files and mutable chunk state. Producers never perform IO or wait. */
public final class HistoryStore implements AutoCloseable {
  public record Options(
      long duration, int retentionDays, int queueCapacity, int cellSize, boolean heatmap) {
    public Options {
      if (duration < 60_000
          || 3_600_000 % duration != 0
          || queueCapacity < 1
          || cellSize < 1
          || retentionDays < -1)
        throw new IllegalArgumentException("Chunk minutes must divide 60; invalid storage options");
    }
  }

  private record Envelope(
      List<Point> points, List<HistoryEvent> events, List<StateRecord> states, boolean gap) {}

  private final Path root;
  private final Registry registry;
  private final Options options;
  private final Consumer<String> log;
  private final ArrayBlockingQueue<Envelope> queue;
  private final Thread worker;
  private final Map<Integer, Point> last = new HashMap<>();
  private final Set<Integer> broken = new HashSet<>();
  private final List<Point> points = new ArrayList<>();
  private final List<HistoryEvent> events = new ArrayList<>();
  private final List<Point> pendingPoints = new ArrayList<>();
  private final List<HistoryEvent> pendingEvents = new ArrayList<>();
  private volatile boolean running = true;
  private boolean overflow;
  private long lastOverflowWarning;
  private volatile Throwable failure;
  private volatile Path publicRoot, retentionRoot;

  private Path backfillRoot;
  private final ArrayDeque<Path> backfill = new ArrayDeque<>();
  private final HeatmapStore heatmaps;
  private final StateStore states;
  private final ArrayDeque<HistoryEvent> liveEvents = new ArrayDeque<>();
  private long lastLiveFlush, lastFullLiveFlush;
  private final ArrayDeque<Point> livePoints = new ArrayDeque<>();
  private void publishLive(long now) throws IOException {
    while (!liveEvents.isEmpty()
        && (liveEvents.size() > 1000 || liveEvents.peekFirst().point().time() < now - 300000))
      liveEvents.removeFirst();
    while (!livePoints.isEmpty()
        && (livePoints.size() > 20000 || livePoints.peekFirst().time() < now - 300000))
      livePoints.removeFirst();

    Path publication = publicRoot;
    if (publication != null) {
      var latest = new HashMap<Integer, Point>();
      for (var point : livePoints) latest.put(point.player(), point);
      var presencePoints =
          latest.values().stream().sorted(Comparator.comparingLong(Point::time)).toList();
      var chatEvents =
          liveEvents.stream().filter(event -> "CHAT".equals(event.type())).toList();

      JsonFiles.write(
          publication.resolve("presence.json"),
          Map.of(
              "protocolVersion",
              2,
              "generatedAt",
              now,
              "points",
              presencePoints,
              "events",
              chatEvents,
              "registry",
              registry.snapshot()));

      if (now - lastFullLiveFlush >= 1000) {
        JsonFiles.write(
            publication.resolve("live.json"),
            Map.of(
                "protocolVersion",
                2,
                "generatedAt",
                now,
                "points",
                List.copyOf(livePoints),
                "events",
                List.copyOf(liveEvents),
                "registry",
                registry.snapshot()));
        lastFullLiveFlush = now;
      }
    }
    lastLiveFlush = now;
  }

  private final AtomicLong stateChanges = new AtomicLong(),
      eventCount = new AtomicLong(),
      inventoryDeltas = new AtomicLong();
  private final Map<Integer, Long> statePlayers = new HashMap<>();
  private final ArrayDeque<Path> stateBackfill = new ArrayDeque<>();
  private final PublishedChunkIndex publishedChunks;
  private final Map<String, Boolean> capabilities = new java.util.concurrent.ConcurrentHashMap<>();
  private volatile Map<String, Boolean> trackingEnabled = Map.of();

  public void capabilities(Map<String, Boolean> value) {
    trackingEnabled = Map.copyOf(value);
    value.forEach((key, enabled) -> capabilities.merge(key, enabled, (a, b) -> a || b));
  }

  private Map<String, Object> publicManifest() {
    var result = new LinkedHashMap<String, Object>();
    result.put("formatVersion", 1);
    result.put("protocolVersion", 2);
    result.put("generatedAt", System.currentTimeMillis());
    result.put("earliestTimestamp", earliest);
    result.put("latestTimestamp", latest);
    result.put("chunkDurationMs", options.duration);
    result.put("chunkRanges", publishedChunks.ranges());
    result.put("registry", registry.snapshot());
    result.put("capabilities", Map.copyOf(capabilities));
    result.put("trackingEnabled", trackingEnabled);
    result.put("activityBucketMs", 60000);
    result.put("activityReady", backfill.isEmpty());
    result.put("cellSize", options.cellSize);
    return result;
  }

  private FileChannel channel;
  private long start = -1, lastFlush, lastMaintenance;
  private long earliest = Long.MAX_VALUE, latest;
  private volatile int retentionDays;

  public void retentionDays(int days) {
    if (days < -1) throw new IllegalArgumentException("Invalid retention");
    retentionDays = days;
  }

  public final AtomicLong dropped = new AtomicLong(),
      bytes = new AtomicLong(),
      written = new AtomicLong();
  public volatile long writerLatency;

  public HistoryStore(Path root, Registry registry, Options options, Consumer<String> log)
      throws IOException {
    this.root = root;
    this.registry = registry;
    this.options = options;
    this.log = log;
    publishedChunks = new PublishedChunkIndex(options.duration);
    queue = new ArrayBlockingQueue<>(options.queueCapacity);
    heatmaps = new HeatmapStore(root, options.duration, options.cellSize);
    Files.createDirectories(root.resolve("tracks"));
    Path settings = root.resolve("settings.json");
    if (Files.exists(settings))
      try (var in = Files.newBufferedReader(settings)) {
        long[] prior = JsonFiles.GSON.fromJson(in, long[].class);
        if (prior.length != 2 || prior[0] != options.duration || prior[1] != options.cellSize)
          throw new IOException(
              "Storage settings changed; archive this dataset before changing chunk duration or"
                  + " cell size");
      }
    JsonFiles.write(settings, new long[] {options.duration, options.cellSize});
    Path capsFile = root.resolve("capabilities.json");
    if (Files.exists(capsFile))
      try (var reader = Files.newBufferedReader(capsFile)) {
        var object = JsonFiles.GSON.fromJson(reader, com.google.gson.JsonObject.class);
        object
            .entrySet()
            .forEach(entry -> capabilities.put(entry.getKey(), entry.getValue().getAsBoolean()));
      }
    retentionDays = options.retentionDays;
    recover();
    states = new StateStore(root, options.duration);
    Path publication = root.resolve("publication.json");
    if (Files.exists(publication))
      try (var in = Files.newBufferedReader(publication)) {
        retentionRoot = Path.of(JsonFiles.GSON.fromJson(in, String.class));
      }
    try (var stream = Files.list(root.resolve("tracks"))) {
      for (Path p : stream.filter(p -> p.toString().endsWith(".bin")).toList()) {
        try {
          long t = Long.parseLong(p.getFileName().toString().replace(".bin", ""));
          earliest = Math.min(earliest, t);
          latest = Math.max(latest, t + options.duration);
        } catch (NumberFormatException ignored) {
        }
      }
    }
    if (latest > 0) {
      Path tail = root.resolve("tracks/" + (latest - options.duration) + ".bin");
      try (var in = Files.newInputStream(tail)) {
        var batch = BinaryCodec.read(in).batch();
        latest =
            Math.max(
                batch.points().stream().mapToLong(Point::time).max().orElse(0),
                batch.events().stream().mapToLong(event -> event.point().time()).max().orElse(0));
        if (!batch.points().isEmpty()) capabilities.put("movement", true);
        Path stateTail = root.resolve("states/" + tail.getFileName());
        if (Files.exists(stateTail))
          try (var stateIn = Files.newInputStream(stateTail)) {
            latest =
                Math.max(
                    latest,
                    StateCodec.read(stateIn).records().stream()
                        .mapToLong(StateRecord::time)
                        .max()
                        .orElse(0));
          }
      } catch (IOException e) {
        log.accept("Cannot read newest chunk metadata: " + e);
      }
    }
    worker = new Thread(this::run, "player-history-writer");
    worker.setDaemon(true);
    worker.start();
  }

  public boolean offer(List<Point> ps, List<HistoryEvent> es) {
    return offer(ps, es, List.of());
  }

  public synchronized boolean offer(List<Point> ps, List<HistoryEvent> es, List<StateRecord> ss) {
    if (ps.size() > 4096 || es.size() > 128 || ss.size() > 128)
      throw new IllegalArgumentException("Envelope exceeds bounds");
    if (!running || failure != null) return false;
    if (!queue.offer(new Envelope(List.copyOf(ps), List.copyOf(es), List.copyOf(ss), overflow))) {
      if (System.currentTimeMillis() - lastOverflowWarning > 5000) {
        lastOverflowWarning = System.currentTimeMillis();
        log.accept("History queue full; recording gap begins (server thread will not block)");
      }
      overflow = true;
      dropped.incrementAndGet();
      return false;
    }
    overflow = false;
    return true;
  }

  public void publishTo(Path path) {
    publicRoot = path;
    retentionRoot = path;
  }

  public void unpublish() {
    publicRoot = null;
  }

  public String stats() {
    return "stateChanges="
        + stateChanges
        + " events="
        + eventCount
        + " inventoryDeltas="
        + inventoryDeltas
        + " retentionDays="
        + retentionDays
        + " written="
        + written
        + " queue="
        + queue.size()
        + " dropped="
        + dropped
        + " bytes="
        + bytes
        + " chunk="
        + start
        + " latencyMs="
        + writerLatency
        + " failure="
        + failure;
  }

  private void run() {
    try {
      while (running || !queue.isEmpty()) {
        Envelope e = queue.poll(200, TimeUnit.MILLISECONDS);
        if (e != null) {
          if (e.gap) {
            long gapTime =
                java.util.stream.Stream.concat(
                        e.points.stream().map(Point::time),
                        java.util.stream.Stream.concat(
                            e.events.stream().map(event -> event.point().time()),
                            e.states.stream().map(StateRecord::time)))
                    .mapToLong(Long::longValue)
                    .min()
                    .orElse(System.currentTimeMillis());
            if (!statePlayers.isEmpty()) ensureChunk(gapTime);
            for (var player : statePlayers.keySet())
              states.append(new StateRecord(player, gapTime, "unknown", Map.of()));
            statePlayers.clear();
            for (var p : List.copyOf(last.values())) {
              append(p.with(p.time(), Point.OFFLINE | Point.BREAK));
              broken.add(p.player());
            }
          }
          for (var p : e.points) {
            if (broken.remove(p.player())) p = p.with(p.time(), p.flags() | Point.BREAK);
            append(p);
            livePoints.addLast(p);
            writerLatency = Math.max(0, System.currentTimeMillis() - p.time());
          }
          for (var record : e.states) {
            ensureChunk(record.time());

            states.append(record);
            statePlayers.put(record.player(), record.time());
            stateChanges.incrementAndGet();
            inventoryDeltas.addAndGet(
                record.values().keySet().stream().filter(k -> k.startsWith("slot:")).count());
            latest = Math.max(latest, record.time());
            earliest = Math.min(earliest, start);
          }
          for (var event : e.events) {
            ensureChunk(event.point().time());
            latest = Math.max(latest, event.point().time());
            earliest = Math.min(earliest, start);
            eventCount.incrementAndGet();
            events.add(event);
            pendingEvents.add(event);
            liveEvents.addLast(event);
          }
        }
        backfill();
        long now = System.currentTimeMillis();
        if (now - lastLiveFlush >= 250) publishLive(now);
        if (now - lastFlush >= 5000
            || pendingPoints.size() >= 4096
            || pendingEvents.size() >= 512) {
          flush();
          if (channel != null && last.values().stream().noneMatch(Point::online)) finish();
          lastFlush = now;
        }
        if (now - lastMaintenance >= 3_600_000) {
          retention(now);
          lastMaintenance = now;
        }
      }
      for (var p : List.copyOf(last.values()))
        if (p.online()) append(p.with(p.time(), Point.OFFLINE));
      flush();
      finish();
      states.close();
    } catch (Throwable e) {
      failure = e;
      log.accept("History writer stopped after IO failure: " + e);
      try {
        if (channel != null) channel.close();
        states.abort();
      } catch (IOException ignored) {
      }
    }
  }

  private void ensureChunk(long time) throws IOException {
    long bucket = TemporaryChunkFiles.bucketStart(time, options.duration);
    if (channel == null || start < 0 || bucket > start) {
      flush();
      finish();
      start = bucket;
      points.clear();
      events.clear();
      Path tracks = root.resolve("tracks");
      Path file = TemporaryChunkFiles.temporary(tracks, start);
      Path existing = TemporaryChunkFiles.completed(tracks, start);
      if (Files.exists(existing)) {
        try (var in = Files.newInputStream(existing)) {
          var data = BinaryCodec.read(in);
          points.addAll(data.batch().points());
          events.addAll(data.batch().events());
        }
        Files.copy(existing, file, StandardCopyOption.REPLACE_EXISTING);
        channel = FileChannel.open(file, StandardOpenOption.WRITE, StandardOpenOption.APPEND);
      } else {
        channel = FileChannel.open(file, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
        var header = new ByteArrayOutputStream();
        BinaryCodec.header(new DataOutputStream(header), start, options.duration);
        write(header.toByteArray());
      }
      for (var prev : last.values())
        if (prev.online()) {
          // Previous actual sample carries session and position context, including its timestamp.
          var context = prev.with(prev.time(), prev.flags() | Point.CONTEXT);
          points.add(context);
          pendingPoints.add(context);
        }
    }
  }

  private void append(Point p) throws IOException {
    ensureChunk(p.time());
    if (points.size() >= 1_000_000)
      throw new IOException(
          "Chunk point cap reached; increase sampling interval or reduce chunk duration");
    if (options.heatmap) {
      Point previous = last.get(p.player());
      if (previous != null) heatmaps.segment(previous, p);
    }
    points.add(p);
    pendingPoints.add(p);
    last.put(p.player(), p);
    latest = Math.max(latest, p.time());
    earliest = Math.min(earliest, start);
    written.incrementAndGet();
  }

  private void write(byte[] data) throws IOException {
    bytes.addAndGet(ChunkChannelIO.writeFully(channel, data));
  }

  private void flush() throws IOException {
    if (channel == null) return;
    // Identities must reach disk before batches referencing newly allocated IDs.
    JsonFiles.write(root.resolve("registry.json"), registry.snapshot());
    if (!pendingPoints.isEmpty() || !pendingEvents.isEmpty()) {
      write(BinaryCodec.frame(new BinaryCodec.Batch(pendingPoints, pendingEvents), start));
      channel.force(false);
      pendingPoints.clear();
      pendingEvents.clear();
    }
    states.flush(publicRoot);
    JsonFiles.write(root.resolve("capabilities.json"), Map.copyOf(capabilities));
    if (options.heatmap) heatmaps.flush(publicRoot);
    Path pub = publicRoot;
    if (pub != null) {
      Files.createDirectories(pub);
      JsonFiles.write(
          pub.resolve("chunks/" + start + ".json"), new BinaryCodec.Batch(points, events));
      publishedChunks.add(start);
      ActivityIndex.publish(
          pub,
          start,
          options.duration,
          java.util.stream.Stream.concat(points.stream(), events.stream().map(HistoryEvent::point))
              .toList());
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
            options.duration));
  }

  private void finish() throws IOException {
    if (channel == null) return;
    ChunkChannelIO.closeDurably(channel);
    channel = null;
    if (options.heatmap) heatmaps.flush(publicRoot, true);
    TemporaryChunkFiles.complete(
        TemporaryChunkFiles.temporary(root.resolve("tracks"), start), start);
  }

  private void backfill() throws IOException {
    Path pub = publicRoot;
    if (pub == null) return;
    if (!pub.equals(backfillRoot)) {
      backfillRoot = pub;
      backfill.clear();
      stateBackfill.clear();
      try (var files = Files.list(root.resolve("states"))) {
        files.filter(f -> f.toString().endsWith(".bin")).sorted().forEach(stateBackfill::add);
      }
      JsonFiles.write(root.resolve("publication.json"), pub.toAbsolutePath().toString());
      retention(System.currentTimeMillis());
      publishedChunks.indexJsonDirectory(pub.resolve("chunks"));
      try (var files = Files.list(root.resolve("tracks"))) {
        files.filter(p -> p.toString().endsWith(".bin")).sorted().forEach(backfill::add);
      }
      Path heat = root.resolve("heatmap");
      if (Files.exists(heat))
        try (var files = Files.walk(heat)) {
          for (Path p : files.filter(Files::isRegularFile).toList()) {
            Path target = pub.resolve("heatmap").resolve(heat.relativize(p));
            Files.createDirectories(target.getParent());
            Files.copy(p, target, StandardCopyOption.REPLACE_EXISTING);
          }
        }
    }
    if (!stateBackfill.isEmpty()) {
      Path file = stateBackfill.removeFirst();
      try {
        states.publish(file, pub);
      } catch (IOException ex) {
        log.accept("Skipping corrupt state chunk " + file + ": " + ex);
      }
    }
    if (!backfill.isEmpty()) {
      Path f = backfill.removeFirst();
      try (var in = Files.newInputStream(f)) {
        var r = BinaryCodec.read(in);
        JsonFiles.write(pub.resolve("chunks/" + r.start() + ".json"), r.batch());
        publishedChunks.add(r.start());
        ActivityIndex.publish(
            pub,
            r.start(),
            options.duration,
            java.util.stream.Stream.concat(
                    r.batch().points().stream(),
                    r.batch().events().stream().map(HistoryEvent::point))
                .toList());
      } catch (IOException e) {
        log.accept("Could not publish historical chunk " + f + ": " + e);
      }
    }
    if (channel == null && latest > 0 && System.currentTimeMillis() - lastFlush >= 5000)
      JsonFiles.write(pub.resolve("manifest.json"), publicManifest());
  }

  private void recover() throws IOException {
    for (Path file : TemporaryChunkFiles.list(root.resolve("tracks"))) {
      try {
        BinaryCodec.Read read;
        try (var in = Files.newInputStream(file)) {
          read = BinaryCodec.read(in);
        }
        TemporaryChunkFiles.repair(
            file,
            read.validBytes(),
            channel -> {
              var tail = new HashMap<Integer, Point>();
              for (var point : read.batch().points()) tail.put(point.player(), point);
              var closed =
                  tail.values().stream()
                      .filter(Point::online)
                      .map(point -> point.with(point.time(), Point.OFFLINE | Point.BREAK))
                      .toList();
              var data =
                  java.nio.ByteBuffer.wrap(
                      BinaryCodec.frame(new BinaryCodec.Batch(closed, List.of()), read.start()));
              while (data.hasRemaining()) channel.write(data);
            });
        TemporaryChunkFiles.complete(file, read.start());
        log.accept(
            "Recovered history chunk "
                + read.start()
                + "; unfinished sessions closed at last durable sample");
      } catch (Exception error) {
        log.accept("Quarantined corrupt history " + file + ": " + error);
        TemporaryChunkFiles.quarantine(file);
      }
    }
  }

  public void retention(long now) throws IOException {
    if (retentionDays < 0) return;
    long cutoff = RetentionFiles.cutoffUtcDay(now, retentionDays);
    RetentionFiles.pruneHistoryTree(root.resolve("tracks"), cutoff);
    RetentionFiles.pruneHistoryTree(root.resolve("states"), cutoff);
    RetentionFiles.pruneHistoryTree(root.resolve("heatmap"), cutoff);
    if (retentionRoot != null) {
      RetentionFiles.pruneHistoryTree(retentionRoot.resolve("chunks"), cutoff);
      RetentionFiles.pruneHistoryTree(retentionRoot.resolve("states"), cutoff);
      RetentionFiles.pruneHistoryTree(retentionRoot.resolve("heatmap"), cutoff);
      RetentionFiles.pruneHistoryTree(retentionRoot.resolve("activity"), cutoff);
    }
    publishedChunks.removeBefore(cutoff);
    earliest = Math.max(earliest, cutoff);
  }

  @Override
  public void close() {
    running = false;
    try {
      worker.join(30_000);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    }
    if (worker.isAlive()) log.accept("History flush still running after 30 seconds");
  }
}
