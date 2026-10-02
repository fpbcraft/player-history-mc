package dev.playerhistory.object;

import dev.playerhistory.core.JsonFiles;
import java.io.IOException;
import java.nio.file.*;
import java.util.*;

public final class ObjectRegistry {
  public record Entry(int id, String provider, String sourceId, String label) {}
  public record Snapshot(List<Entry> objects, List<String> worlds) {}

  private final Map<String, Integer> objectIds = new HashMap<>();
  private final ArrayList<Entry> objects = new ArrayList<>();
  private final Map<String, Integer> worldIds = new HashMap<>();
  private final ArrayList<String> worlds = new ArrayList<>();

  public ObjectRegistry(Path file) throws IOException {
    if (!Files.exists(file)) return;
    try (var reader = Files.newBufferedReader(file)) {
      Snapshot snapshot = JsonFiles.GSON.fromJson(reader, Snapshot.class);
      if (snapshot == null) return;
      if (snapshot.objects() != null)
        for (Entry entry : snapshot.objects()) {
          if (entry.id() != objects.size()) throw new IOException("Invalid object registry ids");
          objects.add(entry);
          objectIds.put(key(entry.provider(), entry.sourceId()), entry.id());
        }
      if (snapshot.worlds() != null)
        for (String world : snapshot.worlds()) {
          worldIds.put(world, worlds.size());
          worlds.add(world);
        }
    }
  }

  public synchronized int object(String provider, String sourceId, String label) {
    String key = key(provider, sourceId);
    Integer existing = objectIds.get(key);
    if (existing != null) {
      Entry old = objects.get(existing);
      if (!Objects.equals(old.label(), label))
        objects.set(existing, new Entry(existing, provider, sourceId, label));
      return existing;
    }
    int id = objects.size();
    objects.add(new Entry(id, provider, sourceId, label));
    objectIds.put(key, id);
    return id;
  }

  public synchronized int world(String world) {
    return worldIds.computeIfAbsent(
        world,
        value -> {
          int id = worlds.size();
          worlds.add(value);
          return id;
        });
  }

  public synchronized Snapshot snapshot() {
    return new Snapshot(List.copyOf(objects), List.copyOf(worlds));
  }

  private static String key(String provider, String sourceId) {
    return provider + "\u0000" + sourceId;
  }
}
