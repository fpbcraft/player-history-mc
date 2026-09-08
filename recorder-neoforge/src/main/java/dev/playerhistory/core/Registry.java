package dev.playerhistory.core;

import java.io.*;
import java.nio.file.*;
import java.util.*;

public final class Registry {
  public record Player(int id, String uuid, String name) {}

  public record World(int id, String key) {}

  public record Item(int id, String key) {}

  public record Snapshot(List<Player> players, List<World> worlds, List<Item> items) {}

  private final List<Item> items = new ArrayList<>();
  private final Map<String, Integer> itemIds = new HashMap<>();

  public synchronized int item(String key) {
    Integer id = itemIds.get(key);
    if (id != null) return id;
    int next = items.size() + 1;
    items.add(new Item(next, key));
    itemIds.put(key, next);
    return next;
  }

  private final List<Player> players = new ArrayList<>();
  private final List<World> worlds = new ArrayList<>();
  private final Map<UUID, Integer> playerIds = new HashMap<>();
  private final Map<String, Integer> worldIds = new HashMap<>();

  public Registry(Path file) throws IOException {
    if (Files.exists(file))
      try (var reader = Files.newBufferedReader(file)) {
        Snapshot s = JsonFiles.GSON.fromJson(reader, Snapshot.class);
        players.addAll(s.players);
        worlds.addAll(s.worlds);
        if (s.items != null)
          for (var item : s.items) {
            if (item.id() != items.size() + 1 || itemIds.put(item.key(), item.id()) != null)
              throw new IOException("Invalid item registry");
            items.add(item);
          }
        for (int i = 0; i < players.size(); i++) {
          var p = players.get(i);
          if (p.id() != i + 1
              || p.name() == null
              || playerIds.put(UUID.fromString(p.uuid()), p.id()) != null)
            throw new IllegalArgumentException("Invalid player registry");
        }
        for (int i = 0; i < worlds.size(); i++) {
          var w = worlds.get(i);
          if (w.id() != i || w.key() == null || worldIds.put(w.key(), w.id()) != null)
            throw new IllegalArgumentException("Invalid world registry");
        }
      } catch (RuntimeException e) {
        throw new IOException("Cannot load identity registry; refusing to reuse IDs", e);
      }
  }

  public synchronized int player(UUID uuid, String name) {
    Integer existing = playerIds.get(uuid);
    if (existing != null) {
      var p = players.get(existing - 1);
      if (!p.name().equals(name)) players.set(existing - 1, new Player(existing, p.uuid(), name));
      return existing;
    }
    int id = players.size() + 1;
    players.add(new Player(id, uuid.toString(), name));
    playerIds.put(uuid, id);
    return id;
  }

  public synchronized int world(String key) {
    Integer existing = worldIds.get(key);
    if (existing != null) return existing;
    int id = worlds.size();
    worlds.add(new World(id, key));
    worldIds.put(key, id);
    return id;
  }

  public synchronized Snapshot snapshot() {
    return new Snapshot(List.copyOf(players), List.copyOf(worlds), List.copyOf(items));
  }
}
