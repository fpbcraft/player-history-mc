package dev.playerhistory.web;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Path;
import java.net.*;
import java.net.http.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;
class WebChatTest {
  @TempDir Path dir;
  @Test void realHttpRejectsUnlinkedAndRevokedBrowsersAndLimitsSending() throws Exception {
    var delivered = new AtomicInteger();
    try (var chat = new WebChat(dir.resolve("auth.json"), "127.0.0.1", 0, (session, message) -> { delivered.incrementAndGet(); return true; })) {
      var client = HttpClient.newHttpClient();
      var base = "http://127.0.0.1:" + chat.port() + "/player-history-api/";
      var pairResponse = client.send(HttpRequest.newBuilder(URI.create(base + "pair")).header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString("{}")).build(), HttpResponse.BodyHandlers.ofString());
      assertEquals(200, pairResponse.statusCode());
      var pair = dev.playerhistory.core.JsonFiles.GSON.fromJson(pairResponse.body(), ChatAuth.Pair.class);
      var send = HttpRequest.newBuilder(URI.create(base + "send")).header("Content-Type", "application/json").header("Authorization", "Bearer " + pair.token()).POST(HttpRequest.BodyPublishers.ofString("{\"message\":\"hello\"}")).build();
      assertEquals(401, client.send(send, HttpResponse.BodyHandlers.ofString()).statusCode());
      assertTrue(chat.auth.link(pair.code(), UUID.randomUUID(), "Tester", System.currentTimeMillis()));
      assertEquals(200, client.send(send, HttpResponse.BodyHandlers.ofString()).statusCode());
      assertEquals(429, client.send(send, HttpResponse.BodyHandlers.ofString()).statusCode());
      assertEquals(1, delivered.get());
      chat.auth.logout(pair.token());
      assertEquals(401, client.send(send, HttpResponse.BodyHandlers.ofString()).statusCode());
      var crossSite = HttpRequest.newBuilder(URI.create(base + "pair")).header("Content-Type", "text/plain").POST(HttpRequest.BodyPublishers.ofString("{}")).build();
      assertEquals(405, client.send(crossSite, HttpResponse.BodyHandlers.ofString()).statusCode());
    }
  }
}
