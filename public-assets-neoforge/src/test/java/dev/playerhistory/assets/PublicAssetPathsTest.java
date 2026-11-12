package dev.playerhistory.assets;
import static org.junit.jupiter.api.Assertions.*;
import java.io.IOException;
import java.nio.file.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class PublicAssetPathsTest {
  @TempDir Path world;
  @Test void rejectsPrivateRootsAndAncestorsButAllowsPublicSibling() throws Exception {
    assertThrows(IOException.class, () -> PublicAssetPaths.resolve(world, Path.of("player-history")));
    assertThrows(IOException.class, () -> PublicAssetPaths.resolve(world, Path.of("player-history/skins")));
    assertThrows(IOException.class, () -> PublicAssetPaths.resolve(world, Path.of(".")));
    assertEquals(world.toRealPath().resolve("player-history-web"), PublicAssetPaths.resolve(world, Path.of("player-history-web")));
  }
  @Test void rejectsSymlinksIntoPrivateHistory() throws Exception {
    Path privateRoot = Files.createDirectories(world.resolve("player-history"));
    Files.createSymbolicLink(world.resolve("public-link"), privateRoot);
    assertThrows(IOException.class, () -> PublicAssetPaths.resolve(world, Path.of("public-link/output")));
  }
}
