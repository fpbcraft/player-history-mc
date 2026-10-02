package dev.playerhistory.core;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ChunkChannelIOTest {
  @TempDir Path root;

  @Test
  void writeFullyPersistsTheEntireBuffer() throws Exception {
    Path file = root.resolve("chunk.tmp");
    try (var channel =
        FileChannel.open(file, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
      assertEquals(5, ChunkChannelIO.writeFully(channel, new byte[] {1, 2, 3, 4, 5}));
    }
    assertArrayEquals(new byte[] {1, 2, 3, 4, 5}, Files.readAllBytes(file));
  }

  @Test
  void closeDurablyClosesTheChannel() throws Exception {
    Path file = root.resolve("chunk.tmp");
    var channel = FileChannel.open(file, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
    ChunkChannelIO.writeFully(channel, new byte[] {1, 2, 3});
    ChunkChannelIO.closeDurably(channel);

    assertFalse(channel.isOpen());
    assertArrayEquals(new byte[] {1, 2, 3}, Files.readAllBytes(file));
  }
}
