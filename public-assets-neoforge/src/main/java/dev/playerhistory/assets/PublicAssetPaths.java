package dev.playerhistory.assets;

import java.io.IOException;
import java.nio.file.*;
import java.util.ArrayDeque;

final class PublicAssetPaths {
  private PublicAssetPaths() {}

  static Path resolve(Path worldRoot, Path configured) throws IOException {
    Path root = realPathIncludingMissing(configured.isAbsolute() ? configured : worldRoot.resolve(configured));
    Path privateRoot = realPathIncludingMissing(worldRoot.resolve("player-history"));
    if (root.startsWith(privateRoot) || privateRoot.startsWith(root)) {
      throw new IOException("Public asset root overlaps private recorder storage: " + root);
    }
    return root;
  }

  private static Path realPathIncludingMissing(Path path) throws IOException {
    path = path.toAbsolutePath().normalize();
    var missing = new ArrayDeque<Path>();
    while (!Files.exists(path)) {
      if (Files.isSymbolicLink(path)) throw new IOException("Dangling asset path link: " + path);
      missing.addFirst(path.getFileName());
      path = path.getParent();
    }
    Path real = path.toRealPath();
    for (Path name : missing) real = real.resolve(name);
    return real;
  }
}
