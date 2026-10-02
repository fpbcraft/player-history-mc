package dev.playerhistory.core;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.ByteBuffer;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class TemporaryChunkFilesTest {
  @TempDir Path root;

  @Test
  void listsOnlyTemporaryChunksInTheRequestedDirectory() throws Exception {
    Files.write(root.resolve("100.tmp"), new byte[0]);
    Files.write(root.resolve("100.bin"), new byte[0]);
    Files.createDirectories(root.resolve("nested"));
    Files.write(root.resolve("nested/200.tmp"), new byte[0]);

    assertEquals(List.of(root.resolve("100.tmp")), TemporaryChunkFiles.list(root));
  }

  @Test
  void repairTruncatesAtDurableBoundaryAndAppendsRepairTail() throws Exception {
    Path file = root.resolve("100.tmp");
    Files.write(file, new byte[] {1, 2, 3, 4, 5});

    TemporaryChunkFiles.repair(
        file,
        3,
        channel -> {
          var tail = ByteBuffer.wrap(new byte[] {9, 8});
          while (tail.hasRemaining()) channel.write(tail);
        });

    assertArrayEquals(new byte[] {1, 2, 3, 9, 8}, Files.readAllBytes(file));
  }

  @Test
  void completeAndQuarantineUseStableSiblingNames() throws Exception {
    Path completed = root.resolve("100.tmp");
    Files.write(completed, new byte[0]);
    TemporaryChunkFiles.complete(completed, 100);
    assertFalse(Files.exists(completed));
    assertTrue(Files.exists(root.resolve("100.bin")));

    Path corrupt = root.resolve("200.tmp");
    Files.write(corrupt, new byte[0]);
    TemporaryChunkFiles.quarantine(corrupt);
    assertFalse(Files.exists(corrupt));
    assertTrue(Files.exists(root.resolve("200.tmp.corrupt")));
  }
}
