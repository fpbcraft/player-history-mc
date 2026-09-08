package dev.playerhistory.web;

import com.sun.net.httpserver.*;
import dev.playerhistory.core.JsonFiles;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.BiFunction;

/** Same-origin reverse-proxy API. No identity is derived from IP or forwarded headers. */
public final class WebChat implements AutoCloseable {
  public final ChatAuth auth;
  private final HttpServer http;
  private final ExecutorService executor = Executors.newFixedThreadPool(2);
  private final BiFunction<ChatAuth.Session, String, Boolean> send;
  private final ArrayDeque<Map<String, Object>> messages = new ArrayDeque<>();
  private final Map<String, Long> lastSend = new HashMap<>();
  private long sequence, nextPair;
  public WebChat(Path privateFile, String bind, int port, BiFunction<ChatAuth.Session, String, Boolean> send) throws Exception {
    this.auth = new ChatAuth(privateFile); this.send = send;
    http = HttpServer.create(new InetSocketAddress(bind, port), 32);
    http.setExecutor(executor);
    http.createContext("/player-history-api/", this::handle);
    http.start();
  }
  public int port() { return http.getAddress().getPort(); }
  public synchronized void receive(String name, String message, boolean web) {
    messages.addLast(Map.of("id", ++sequence, "time", System.currentTimeMillis(), "name", name, "message", message, "web", web));
    while (messages.size() > 100) messages.removeFirst();
  }
  private void reply(HttpExchange x, int status, Object data) throws java.io.IOException {
    byte[] bytes = JsonFiles.GSON.toJson(data).getBytes(StandardCharsets.UTF_8);
    x.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
    x.getResponseHeaders().set("Cache-Control", "no-store");
    x.getResponseHeaders().set("X-Content-Type-Options", "nosniff");
    x.sendResponseHeaders(status, bytes.length);
    x.getResponseBody().write(bytes); x.close();
  }
  private void handle(HttpExchange x) throws java.io.IOException {
    try {
      String path = x.getRequestURI().getPath(), method = x.getRequestMethod();
      long now = System.currentTimeMillis();
      if (method.equals("GET") && path.equals("/player-history-api/messages")) {
        synchronized (this) { reply(x, 200, Map.of("messages", List.copyOf(messages))); } return;
      }
      if (!method.equals("POST") || !"application/json".equals(x.getRequestHeaders().getFirst("Content-Type"))) {
        reply(x, 405, Map.of("error", "Use POST with application/json")); return;
      }
      byte[] bytes = x.getRequestBody().readNBytes(4097);
      if (bytes.length > 4096) { reply(x, 413, Map.of("error", "Request too large")); return; }
      if (path.equals("/player-history-api/pair")) {
        synchronized (this) {
          if (now < nextPair) { reply(x, 429, Map.of("error", "Please wait a moment")); return; }
          nextPair = now + 1000;
        }
        reply(x, 200, auth.pair(now)); return;
      }
      String header = x.getRequestHeaders().getFirst("Authorization");
      String token = header != null && header.startsWith("Bearer ") ? header.substring(7) : "";
      var session = auth.session(token, now);
      if (path.equals("/player-history-api/session")) {
        reply(x, 200, session == null ? Map.of("linked", false) : Map.of("linked", true, "name", session.name())); return;
      }
      if (session == null) { reply(x, 401, Map.of("error", "Connect your Minecraft account first")); return; }
      if (path.equals("/player-history-api/logout")) { auth.logout(token); reply(x, 200, Map.of("ok", true)); return; }
      if (!path.equals("/player-history-api/send")) { reply(x, 404, Map.of("error", "Not found")); return; }
      String message = com.google.gson.JsonParser.parseString(new String(bytes, StandardCharsets.UTF_8)).getAsJsonObject().get("message").getAsString().strip();
      if (message.isEmpty() || message.length() > 256 || message.codePoints().anyMatch(c -> Character.isISOControl(c) || c == 167)) {
        reply(x, 400, Map.of("error", "Use 1–256 characters without control or formatting codes")); return;
      }
      synchronized (this) {
        lastSend.values().removeIf(t -> t < now - 60000);
        if (now - lastSend.getOrDefault(session.uuid(), 0L) < 2000) { reply(x, 429, Map.of("error", "Wait two seconds between messages")); return; }
        lastSend.put(session.uuid(), now);
      }
      if (!send.apply(session, message)) { reply(x, 403, Map.of("error", "This account cannot send chat to the server")); return; }
      reply(x, 200, Map.of("ok", true));
    } catch (IllegalStateException e) { reply(x, 429, Map.of("error", "Please try again later")); }
      catch (Exception e) { reply(x, 400, Map.of("error", "Unable to process request")); }
  }
  public void close() { http.stop(0); executor.shutdownNow(); }
}
