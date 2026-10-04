package dev.playerhistory.object;

import dev.playerhistory.core.JsonFiles;
import dev.playerhistory.core.LogSink;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.*;

/**
 * Durable copy of BlueMap3D geometry versions referenced by object history.
 *
 * <p>BlueMap3D intentionally deletes superseded meshes and clears its live mesh directory
 * on restart. This archive keeps each referenced .bm3d + atlas under Player History and
 * rewrites the embedded atlas URL so the archived model remains self-contained.
 */
public final class ObjectGeometryArchive {
  public record Entry(
      String provider,
      String sourceId,
      long version,
      String mesh,
      String atlas,
      long lastReferencedAt) {}

  private record Key(String provider, String sourceId, long version) {}

  private final Path root;
  private final LogSink log;
  private final Map<Key, Entry> entries = new LinkedHashMap<>();
  private final Map<Key, Long> references = new HashMap<>();
  private volatile Path publicRoot;
  private boolean dirty;

  public ObjectGeometryArchive(Path root, LogSink log) throws IOException {
    this.root = root;
    this.log = log;
    Files.createDirectories(root.resolve("geometry"));
    load();
  }

  public synchronized void reference(String provider, String sourceId, long version, long time) {
    Key key = new Key(provider, sourceId, version);
    references.merge(key, time, Math::max);
    Entry entry = entries.get(key);
    if (entry != null && time > entry.lastReferencedAt()) {
      entries.put(
          key,
          new Entry(
              entry.provider(),
              entry.sourceId(),
              entry.version(),
              entry.mesh(),
              entry.atlas(),
              time));
      dirty = true;
    }
  }

  public synchronized void archive(
      String provider,
      String sourceId,
      long version,
      Path sourceMesh,
      Path sourceAtlas)
      throws IOException {
    Objects.requireNonNull(sourceMesh, "sourceMesh");
    Key key = new Key(provider, sourceId, version);
    String stem = digest(provider + "\u0000" + sourceId + "\u0000" + version);
    String meshName = stem + ".bm3d";
    String atlasName = stem + ".png";
    String meshRelative = "geometry/" + meshName;
    String atlasRelative = "geometry/" + atlasName;

    Path targetMesh = root.resolve(meshRelative);
    Path targetAtlas = root.resolve(atlasRelative);

    if (!Files.exists(targetMesh)) {
      if (!Files.isRegularFile(sourceMesh))
        throw new IOException("BlueMap3D mesh is not readable: " + sourceMesh);
      Files.createDirectories(targetMesh.getParent());

      String publicAtlasUrl = "player-history/data/objects/" + atlasRelative;
      byte[] rewritten = rewriteAtlasUrl(Files.readAllBytes(sourceMesh), publicAtlasUrl);
      writeAtomically(targetMesh, rewritten);

      if (sourceAtlas != null && Files.isRegularFile(sourceAtlas))
        copyAtomically(sourceAtlas, targetAtlas);
    } else if (!Files.exists(targetAtlas)
        && sourceAtlas != null
        && Files.isRegularFile(sourceAtlas)) {
      copyAtomically(sourceAtlas, targetAtlas);
    }

    long referenced = references.getOrDefault(key, System.currentTimeMillis());
    Entry existing = entries.get(key);
    if (existing != null) referenced = Math.max(referenced, existing.lastReferencedAt());
    entries.put(
        key,
        new Entry(provider, sourceId, version, meshRelative, atlasRelative, referenced));
    dirty = true;

    Path pub = publicRoot;
    if (pub != null) publishEntry(entries.get(key), pub);
  }

  public synchronized void publishTo(Path publicObjectsRoot) throws IOException {
    publicRoot = publicObjectsRoot;
    Files.createDirectories(publicObjectsRoot.resolve("geometry"));
    for (Entry entry : entries.values()) publishEntry(entry, publicObjectsRoot);
    save();
  }

  public synchronized List<Entry> entries() {
    return List.copyOf(entries.values());
  }

  public synchronized void flush() throws IOException {
    if (dirty) save();
  }

  public synchronized void prune(long cutoff) throws IOException {
    Iterator<Map.Entry<Key, Entry>> iterator = entries.entrySet().iterator();
    while (iterator.hasNext()) {
      Map.Entry<Key, Entry> row = iterator.next();
      Entry entry = row.getValue();
      if (entry.lastReferencedAt() >= cutoff) continue;

      Files.deleteIfExists(root.resolve(entry.mesh()));
      Files.deleteIfExists(root.resolve(entry.atlas()));
      Path pub = publicRoot;
      if (pub != null) {
        Files.deleteIfExists(pub.resolve(entry.mesh()));
        Files.deleteIfExists(pub.resolve(entry.atlas()));
      }
      references.remove(row.getKey());
      iterator.remove();
      dirty = true;
    }
    flush();
  }

  public synchronized int size() {
    return entries.size();
  }

  private void publishEntry(Entry entry, Path pub) throws IOException {
    copyAtomically(root.resolve(entry.mesh()), pub.resolve(entry.mesh()));
    Path atlas = root.resolve(entry.atlas());
    if (Files.isRegularFile(atlas)) copyAtomically(atlas, pub.resolve(entry.atlas()));
  }

  private void load() throws IOException {
    Path index = root.resolve("geometry-index.json");
    if (!Files.isRegularFile(index)) return;
    try (var reader = Files.newBufferedReader(index)) {
      Entry[] stored = JsonFiles.GSON.fromJson(reader, Entry[].class);
      if (stored == null) return;
      for (Entry entry : stored) {
        if (entry == null
            || entry.provider() == null
            || entry.sourceId() == null
            || entry.mesh() == null
            || entry.atlas() == null)
          continue;
        entries.put(new Key(entry.provider(), entry.sourceId(), entry.version()), entry);
      }
    }
  }

  private void save() throws IOException {
    JsonFiles.write(root.resolve("geometry-index.json"), entries.values());
    dirty = false;
  }

  private static byte[] rewriteAtlasUrl(byte[] source, String atlasUrl) throws IOException {
    if (source.length < 20
        || source[0] != 'B'
        || source[1] != 'M'
        || source[2] != '3'
        || source[3] != 'D')
      throw new IOException("Invalid BM3D file");

    ByteBuffer old = ByteBuffer.wrap(source).order(ByteOrder.LITTLE_ENDIAN);
    long oldLengthUnsigned = Integer.toUnsignedLong(old.getInt(16));
    if (oldLengthUnsigned > Integer.MAX_VALUE)
      throw new IOException("BM3D atlas URL is too large");
    int oldLength = (int) oldLengthUnsigned;
    int oldTail = 20 + align4(oldLength);
    if (oldTail < 20 || oldTail > source.length)
      throw new IOException("Invalid BM3D atlas URL length");

    byte[] url = atlasUrl.getBytes(StandardCharsets.UTF_8);
    int newTail = 20 + align4(url.length);
    byte[] result = new byte[newTail + (source.length - oldTail)];

    System.arraycopy(source, 0, result, 0, 16);
    ByteBuffer.wrap(result).order(ByteOrder.LITTLE_ENDIAN).putInt(16, url.length);
    System.arraycopy(url, 0, result, 20, url.length);
    System.arraycopy(source, oldTail, result, newTail, source.length - oldTail);
    return result;
  }

  private static int align4(int value) {
    return (value + 3) & ~3;
  }

  private static String digest(String value) {
    try {
      byte[] bytes = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
      StringBuilder out = new StringBuilder(bytes.length * 2);
      for (byte b : bytes) out.append(String.format("%02x", b & 0xff));
      return out.toString();
    } catch (NoSuchAlgorithmException error) {
      throw new IllegalStateException("SHA-256 unavailable", error);
    }
  }

  private static void copyAtomically(Path source, Path target) throws IOException {
    Files.createDirectories(target.getParent());
    Path temp = target.resolveSibling(target.getFileName() + ".tmp");
    Files.copy(source, temp, StandardCopyOption.REPLACE_EXISTING);
    move(temp, target);
  }

  private static void writeAtomically(Path target, byte[] bytes) throws IOException {
    Files.createDirectories(target.getParent());
    Path temp = target.resolveSibling(target.getFileName() + ".tmp");
    Files.write(temp, bytes);
    move(temp, target);
  }

  private static void move(Path source, Path target) throws IOException {
    try {
      Files.move(
          source,
          target,
          StandardCopyOption.REPLACE_EXISTING,
          StandardCopyOption.ATOMIC_MOVE);
    } catch (AtomicMoveNotSupportedException ignored) {
      Files.move(source, target, StandardCopyOption.REPLACE_EXISTING);
    }
  }
}
