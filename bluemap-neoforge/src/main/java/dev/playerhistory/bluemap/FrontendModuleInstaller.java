package dev.playerhistory.bluemap;

import com.google.gson.Gson;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

/** Install versioned modules before publishing the bootstrap that references them. */
final class FrontendModuleInstaller {
  private FrontendModuleInstaller() {}

  static void install(Class<?> resources, Path root, String version) throws IOException {
    String[] assets;
    try (var stream = resources.getResourceAsStream("/player-history-assets.json")) {
      if (stream == null) throw new IOException("Missing frontend module index");
      assets = new Gson().fromJson(new InputStreamReader(stream, StandardCharsets.UTF_8), String[].class);
    }
    if (assets == null || assets.length == 0) throw new IOException("Empty frontend module index");
    for (String asset : assets) {
      Path target = target(root, version, asset);
      try (var stream = resources.getResourceAsStream("/" + asset)) {
        if (stream == null) throw new IOException("Missing frontend module " + asset);
        Files.createDirectories(target.getParent());
        Files.copy(stream, target, StandardCopyOption.REPLACE_EXISTING);
      }
    }
  }

  static Path target(Path root, String version, String asset) throws IOException {
    if (asset == null || !asset.startsWith("modules/" + version + "/")
        || !asset.matches("modules/[A-Za-z0-9.+-]+/(?:chunks/)?[A-Za-z0-9_-]+\\.js"))
      throw new IOException("Invalid frontend module path: " + asset);
    return root.resolve(asset);
  }
}
