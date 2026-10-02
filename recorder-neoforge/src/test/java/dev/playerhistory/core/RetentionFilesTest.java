package dev.playerhistory.core;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class RetentionFilesTest {
  private static final long DAY_MS = 86_400_000L;

  @TempDir Path root;

  @Test
  void cutoffIsAlignedToUtcDay() {
    long day = 100 * DAY_MS;
    assertEquals(70 * DAY_MS, RetentionFiles.cutoffUtcDay(day + 12_345, 30));
    assertEquals(day, RetentionFiles.cutoffUtcDay(day + DAY_MS - 1, 0));
    assertThrows(IllegalArgumentException.class, () -> RetentionFiles.cutoffUtcDay(day, -1));
  }

  @Test
  void historyTreePrunesEligibleFilesRecursively() throws Exception {
    long cutoff = 100 * DAY_MS;
    Path nested = root.resolve("history/nested");
    Files.createDirectories(nested);

    Path oldBin = nested.resolve((cutoff - DAY_MS) + ".bin");
    Path oldTemp = nested.resolve((cutoff - DAY_MS) + ".json.tmp");
    Path oldOther = nested.resolve((cutoff - DAY_MS) + ".txt");
    Path recent = nested.resolve(cutoff + ".json");
    Files.writeString(oldBin, "");
    Files.writeString(oldTemp, "");
    Files.writeString(oldOther, "");
    Files.writeString(recent, "");

    RetentionFiles.pruneHistoryTree(root.resolve("history"), cutoff);

    assertFalse(Files.exists(oldBin));
    assertFalse(Files.exists(oldTemp));
    assertTrue(Files.exists(oldOther));
    assertTrue(Files.exists(recent));
  }

  @Test
  void flatDirectoryDoesNotRecurseAndAcceptsAnyTimestampedSuffix() throws Exception {
    long cutoff = 100 * DAY_MS;
    Path flat = root.resolve("flat");
    Path nested = flat.resolve("nested");
    Files.createDirectories(nested);

    Path oldDirect = flat.resolve((cutoff - DAY_MS) + ".custom");
    Path oldNested = nested.resolve((cutoff - DAY_MS) + ".custom");
    Path recent = flat.resolve(cutoff + ".custom");
    Files.writeString(oldDirect, "");
    Files.writeString(oldNested, "");
    Files.writeString(recent, "");

    RetentionFiles.pruneFlatDirectory(flat, cutoff);

    assertFalse(Files.exists(oldDirect));
    assertTrue(Files.exists(oldNested));
    assertTrue(Files.exists(recent));
  }
}
