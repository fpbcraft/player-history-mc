package dev.playerhistory.bluemap;

import static org.junit.jupiter.api.Assertions.*;
import java.io.IOException;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

class FrontendModuleInstallerTest {
  @Test void modulePathsMustBelongToTheInstalledVersion() throws IOException {
    Path root = Path.of("web/player-history");
    assertEquals(root.resolve("modules/2.5.0/live.js"),
        FrontendModuleInstaller.target(root, "2.5.0", "modules/2.5.0/live.js"));
    assertThrows(IOException.class, () -> FrontendModuleInstaller.target(root, "2.5.0", "modules/old/live.js"));
    assertThrows(IOException.class, () -> FrontendModuleInstaller.target(root, "2.5.0", "modules/2.5.0/../../outside.js"));
    assertThrows(IOException.class, () -> FrontendModuleInstaller.target(root, "2.5.0", "/outside.js"));
  }
}
