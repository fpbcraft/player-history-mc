package dev.playerhistory.web;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;
class ChatAuthTest {
  @TempDir Path dir;
  @Test void pairingRequiresBrowserSecretAndIsSingleUse() throws Exception {
    var auth = new ChatAuth(dir.resolve("sessions.json"));
    var pair = auth.pair(1000); var uuid = UUID.randomUUID();
    assertNull(auth.session(pair.token(), 1001));
    assertTrue(auth.link(pair.code(), uuid, "Player", 2000));
    assertFalse(auth.link(pair.code(), UUID.randomUUID(), "Other", 2001));
    assertNull(auth.session(pair.code(), 2001));
    assertEquals(uuid.toString(), auth.session(pair.token(), 2001).uuid());
    assertFalse(Files.readString(dir.resolve("sessions.json")).contains(pair.token()));
    var restarted = new ChatAuth(dir.resolve("sessions.json"));
    assertNotNull(restarted.session(pair.token(), 2002));
    restarted.revoke(uuid);
    assertNull(new ChatAuth(dir.resolve("sessions.json")).session(pair.token(), 2003));
  }
  @Test void expirationAndLogout() throws Exception {
    var auth = new ChatAuth(dir.resolve("sessions.json"));
    var expired = auth.pair(0);
    assertFalse(auth.link(expired.code(), UUID.randomUUID(), "Player", 300000));
    var pair = auth.pair(300001);
    assertTrue(auth.link(pair.code(), UUID.randomUUID(), "Player", 300002));
    assertNull(auth.session(pair.token(), 300002 + 30L * 86400000));
    auth.logout(pair.token());
    assertNull(auth.session(pair.token(), 300003));
  }
}
