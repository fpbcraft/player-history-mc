package dev.playerhistory.assets;
import static org.junit.jupiter.api.Assertions.*;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;

class PublicSnapshotWriterTest {
  @Test void slowConsumerCoalescesSnapshotsAndDoesNotBlockOffers() throws Exception {
    var entered = new CountDownLatch(1); var release = new CountDownLatch(1); var finished = new CountDownLatch(1);
    var seen = new CopyOnWriteArrayList<Object>();
    try (var writer = new PublicSnapshotWriter((PublicSnapshotWriter.Pending next) -> {
      seen.add(next.value());
      if (seen.size() == 1) {
        entered.countDown();
        try { release.await(5, TimeUnit.SECONDS); } catch (InterruptedException error) { Thread.currentThread().interrupt(); }
      }
      if (Integer.valueOf(1000).equals(next.value())) finished.countDown();
    })) {
      writer.offer(Path.of("unused"), 0);
      assertTrue(entered.await(5, TimeUnit.SECONDS));
      for (int i = 1; i <= 1000; i++) writer.offer(Path.of("unused"), i);
      release.countDown(); assertTrue(finished.await(5, TimeUnit.SECONDS));
      assertEquals(List.of(0, 1000), seen);
    } finally { release.countDown(); }
  }
}
