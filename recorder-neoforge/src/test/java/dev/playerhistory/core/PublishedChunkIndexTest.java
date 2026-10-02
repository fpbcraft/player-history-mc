package dev.playerhistory.core;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class PublishedChunkIndexTest {
  @TempDir Path root;

  @Test
  void compactsAdjacentChunksIntoRanges() {
    var index = new PublishedChunkIndex(100);
    index.add(100);
    index.add(200);
    index.add(400);

    var ranges = index.ranges();
    assertArrayEquals(new long[] {100, 300}, ranges.get(0));
    assertArrayEquals(new long[] {400, 500}, ranges.get(1));

    index.removeBefore(300);
    ranges = index.ranges();
    assertEquals(1, ranges.size());
    assertArrayEquals(new long[] {400, 500}, ranges.get(0));
  }

  @Test
  void indexesOnlyTimestampedJsonFiles() throws Exception {
    Files.writeString(root.resolve("100.json"), "{}");
    Files.writeString(root.resolve("200.json"), "{}");
    Files.writeString(root.resolve("notes.json"), "{}");
    Files.writeString(root.resolve("300.bin"), "");

    var index = new PublishedChunkIndex(100);
    index.indexJsonDirectory(root);

    var ranges = index.ranges();
    assertEquals(1, ranges.size());
    assertArrayEquals(new long[] {100, 300}, ranges.get(0));
  }
}
