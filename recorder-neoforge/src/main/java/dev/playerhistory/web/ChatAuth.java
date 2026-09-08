package dev.playerhistory.web;

import dev.playerhistory.core.JsonFiles;
import java.nio.file.*;
import java.security.*;
import java.util.*;

/** Private bearer sessions. Pairing codes authorize only their original browser secret. */
public final class ChatAuth {
  public record Session(String uuid, String name, long expires) {}
  public record Pair(String code, String token) {}
  private record Pending(String hash, long expires) {}
  private final Map<String, Pending> pending = new HashMap<>();
  private final Map<String, Session> sessions = new HashMap<>();
  private final SecureRandom random = new SecureRandom();
  private final Path file;
  public ChatAuth(Path file) throws Exception {
    this.file = file;
    if (Files.exists(file)) {
      try (var reader = Files.newBufferedReader(file)) {
        var object = com.google.gson.JsonParser.parseReader(reader).getAsJsonObject();
        object.entrySet().forEach(e -> sessions.put(e.getKey(), JsonFiles.GSON.fromJson(e.getValue(), Session.class)));
      }
    }
  }
  private String secret(int bytes) {
    byte[] value = new byte[bytes]; random.nextBytes(value);
    return HexFormat.of().formatHex(value);
  }
  private static String hash(String token) {
    try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(java.nio.charset.StandardCharsets.UTF_8))); }
    catch (NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
  }
  public synchronized Pair pair(long now) {
    pending.values().removeIf(p -> p.expires <= now);
    if (pending.size() >= 100) throw new IllegalStateException("Too many pending links; try again later");
    String code; do { code = secret(4).toUpperCase(Locale.ROOT); } while (pending.containsKey(code));
    String token = secret(32);
    pending.put(code, new Pending(hash(token), now + 300000));
    return new Pair(code, token);
  }
  public synchronized boolean link(String code, UUID uuid, String name, long now) throws Exception {
    Pending p = pending.remove(code.replace("-", "").toUpperCase(Locale.ROOT));
    if (p == null || p.expires <= now) return false;
    sessions.values().removeIf(s -> s.expires <= now);
    if (sessions.size() >= 10000) throw new IllegalStateException("Session limit reached");
    String key = p.hash;
    sessions.put(key, new Session(uuid.toString(), name, now + 30L * 86400000));
    try { JsonFiles.write(file, sessions); } catch (Exception failure) { sessions.remove(key); throw failure; }
    return true;
  }
  public synchronized Session session(String token, long now) {
    if (token == null || token.length() != 64) return null;
    Session s = sessions.get(hash(token));
    return s != null && s.expires > now ? s : null;
  }
  public synchronized void logout(String token) throws Exception {
    sessions.remove(hash(token)); JsonFiles.write(file, sessions);
  }
  public synchronized void revoke(UUID uuid) throws Exception {
    sessions.values().removeIf(s -> s.uuid.equals(uuid.toString())); JsonFiles.write(file, sessions);
  }
}
