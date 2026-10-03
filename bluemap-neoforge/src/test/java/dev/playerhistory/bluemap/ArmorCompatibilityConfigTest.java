package dev.playerhistory.bluemap;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class ArmorCompatibilityConfigTest {
  @TempDir Path temp;

  @Test
  void overlaysServerMappingsOnBuiltInDefaults() throws Exception {
    Path config = temp.resolve("config");
    Files.createDirectories(config);
    Files.writeString(
        config.resolve("playerhistory_bluemap-armor.json"),
        """
        {
          "geometryAliases": {
            "rogues:berserker_armor": "custom_berserker",
            "example:odd_set": "shared_model"
          },
          "textureAliases": {
            "example:odd_set": "shared_texture"
          }
        }
        """);

    var logs = new ArrayList<String>();
    var data = ArmorCompatibilityConfig.load(temp, logs::add);

    assertEquals("custom_berserker", data.geometryFamily("rogues", "berserker_armor"));
    assertEquals("shared_model", data.geometryFamily("example", "odd_set"));
    assertEquals("shared_texture", data.textureFamily("example", "odd_set"));
    assertEquals("wizard_robes", data.geometryFamily("wizards", "fire_robe"));
    assertFalse(logs.isEmpty());
  }
}
