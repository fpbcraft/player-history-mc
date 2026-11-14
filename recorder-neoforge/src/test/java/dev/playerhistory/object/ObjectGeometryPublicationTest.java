package dev.playerhistory.object;

import static org.junit.jupiter.api.Assertions.*;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ObjectGeometryPublicationTest {
  @TempDir Path root;

  private void archive(ObjectGeometryArchive archive, long version) throws Exception {
    Path mesh = root.resolve("source.bm3d");
    byte[] bytes = new byte[24];
    bytes[0] = 'B'; bytes[1] = 'M'; bytes[2] = '3'; bytes[3] = 'D';
    Files.write(mesh, bytes);
    Path atlas = root.resolve("source.png");
    Files.write(atlas, new byte[] {1, 2, 3});
    archive.archive("sable_ships", "ship", version, mesh, atlas);
  }

  private void drain(ObjectGeometryArchive archive) {
    while (archive.hasPendingPublications()) archive.publishNext();
  }

  @Test
  void selectingDestinationDoesNoIoAndSlowCopyDoesNotBlockSnapshots() throws Exception {
    var copying = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    var archive = new ObjectGeometryArchive(root.resolve("archive"), ignored -> {}, (source, target) -> {
      copying.countDown();
      try {
        if (!release.await(5, TimeUnit.SECONDS)) throw new IOException("Test copy timed out");
      } catch (InterruptedException error) {
        Thread.currentThread().interrupt();
        throw new IOException(error);
      }
    });
    archive(archive, 1);
    Path destination = root.resolve("public");
    archive.publishTo(destination);
    assertFalse(Files.exists(destination));
    assertEquals(1, copying.getCount());
    try (var executor = Executors.newFixedThreadPool(2)) {
      var publication = executor.submit(archive::publishNext);
      try {
        assertTrue(copying.await(5, TimeUnit.SECONDS));
        executor.submit(() -> {
          archive.reference("sable_ships", "ship", 1, Long.MAX_VALUE);
          assertEquals(Long.MAX_VALUE, archive.entries().getFirst().lastReferencedAt());
        }).get(2, TimeUnit.SECONDS);
      } finally {
        release.countDown();
      }
      publication.get(5, TimeUnit.SECONDS);
    }
  }

  @Test
  void restartReusesCompleteFilesAndRepairsMissingOrTruncatedCopies() throws Exception {
    Path directory = root.resolve("archive"), destination = root.resolve("public");
    var archive = new ObjectGeometryArchive(directory, ignored -> {});
    archive(archive, 1);
    archive.publishTo(destination);
    drain(archive);
    archive.flush();
    var entry = archive.entries().getFirst();
    Path mesh = destination.resolve(entry.mesh()), atlas = destination.resolve(entry.atlas());
    var oldTime = FileTime.fromMillis(1_000_000);
    Files.setLastModifiedTime(mesh, oldTime);
    Files.setLastModifiedTime(atlas, oldTime);

    var restarted = new ObjectGeometryArchive(directory, ignored -> {});
    restarted.publishTo(destination);
    drain(restarted);
    assertEquals(oldTime, Files.getLastModifiedTime(mesh));
    assertEquals(oldTime, Files.getLastModifiedTime(atlas));
    Files.delete(mesh);
    Files.write(atlas, new byte[] {9});
    restarted.publishTo(destination);
    drain(restarted);
    assertArrayEquals(Files.readAllBytes(directory.resolve(entry.mesh())), Files.readAllBytes(mesh));
    assertArrayEquals(new byte[] {1, 2, 3}, Files.readAllBytes(atlas));
  }

  @Test
  void failedEntryDoesNotStopLaterPublication() throws Exception {
    var errors = new AtomicInteger();
    var archive = new ObjectGeometryArchive(root.resolve("archive"), ignored -> errors.incrementAndGet());
    archive(archive, 1);
    archive(archive, 2);
    Files.delete(root.resolve("archive").resolve(archive.entries().getFirst().mesh()));
    Path destination = root.resolve("public");
    archive.publishTo(destination);
    drain(archive);
    assertEquals(1, errors.get());
    assertTrue(Files.isRegularFile(destination.resolve(archive.entries().getLast().mesh())));
  }

  @Test
  void retargetsQueuedWorkAndPrunesBeforePublication() throws Exception {
    var archive = new ObjectGeometryArchive(root.resolve("archive"), ignored -> {});
    archive(archive, 1);
    Path first = root.resolve("first"), second = root.resolve("second");
    archive.publishTo(first);
    archive.publishTo(second);
    drain(archive);
    var entry = archive.entries().getFirst();
    assertFalse(Files.exists(first));
    assertTrue(Files.isRegularFile(second.resolve(entry.mesh())));
    archive.publishTo(second);
    archive.prune(Long.MAX_VALUE);
    assertFalse(archive.hasPendingPublications());
    assertFalse(Files.exists(second.resolve(entry.mesh())));
  }

  @Test
  void newlyArchivedVersionsAreQueuedAndDuplicateRequestsAreCoalesced() throws Exception {
    var copies = new AtomicInteger();
    var archive = new ObjectGeometryArchive(root.resolve("archive"), ignored -> {},
        (source, target) -> copies.incrementAndGet());
    archive.publishTo(root.resolve("public"));
    archive(archive, 1);
    archive(archive, 1);
    assertEquals(0, copies.get());
    drain(archive);
    assertEquals(2, copies.get());
    archive(archive, 2);
    drain(archive);
    assertEquals(4, copies.get());
  }

  @Test
  void pruningWaitsForInflightCopyAndDoesNotResurrectExpiredFiles() throws Exception {
    var copying = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    var archive = new ObjectGeometryArchive(root.resolve("archive"), ignored -> {}, (source, target) -> {
      copying.countDown();
      try {
        if (!release.await(5, TimeUnit.SECONDS)) throw new IOException("Test copy timed out");
      } catch (InterruptedException error) {
        Thread.currentThread().interrupt();
        throw new IOException(error);
      }
      Files.createDirectories(target.getParent());
      Files.copy(source, target);
    });
    archive(archive, 1);
    var entry = archive.entries().getFirst();
    Path destination = root.resolve("public");
    archive.publishTo(destination);
    try (var executor = Executors.newFixedThreadPool(2)) {
      var publication = executor.submit(archive::publishNext);
      try {
        assertTrue(copying.await(5, TimeUnit.SECONDS));
        var pruning = executor.submit(() -> { archive.prune(Long.MAX_VALUE); return null; });
        release.countDown();
        publication.get(5, TimeUnit.SECONDS);
        pruning.get(5, TimeUnit.SECONDS);
      } finally {
        release.countDown();
      }
    }
    assertEquals(0, archive.size());
    assertFalse(Files.exists(destination.resolve(entry.mesh())));
    assertFalse(Files.exists(destination.resolve(entry.atlas())));
  }

  @Test
  void recorderPublishesExistingArchiveWithoutNewSnapshots() throws Exception {
    Path directory = root.resolve("objects"), destination = root.resolve("public");
    var archive = new ObjectGeometryArchive(directory, ignored -> {});
    archive(archive, 1);
    archive.flush();
    var options = new ObjectHistoryRecorder.Options(60_000, -1, 64, .25, 1, 30_000);
    try (var recorder = new ObjectHistoryRecorder(directory, options, ignored -> {})) {
      recorder.publishTo(destination);
    }
    var entry = archive.entries().getFirst();
    assertTrue(Files.isRegularFile(destination.resolve("objects").resolve(entry.mesh())));
    assertTrue(Files.isRegularFile(destination.resolve("objects").resolve(entry.atlas())));
  }
}
