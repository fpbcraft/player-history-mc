package dev.playerhistory.bluemap;

import static org.junit.jupiter.api.Assertions.*;

import com.google.gson.JsonParser;
import java.util.Arrays;
import java.util.Set;
import org.junit.jupiter.api.Test;

final class CustomArmorAssetResolverTest {
  @Test
  void bakesBedrockHumanoidGeometryIntoPlayerPartSpace() {
    var root =
        JsonParser.parseString(
                """
                {
                  "minecraft:geometry": [{
                    "description": {
                      "identifier": "geometry.test_armor",
                      "texture_width": 128,
                      "texture_height": 128
                    },
                    "bones": [
                      {"name":"bipedHead","pivot":[0,24,0]},
                      {
                        "name":"armorHead",
                        "parent":"bipedHead",
                        "pivot":[0,24,0],
                        "cubes":[
                          {"origin":[-4,24,-4],"size":[8,8,8],"uv":[0,0]}
                        ]
                      },
                      {"name":"bipedBody","pivot":[0,24,0]},
                      {"name":"bipedRightArm","pivot":[-5,22,0]},
                      {"name":"bipedLeftArm","pivot":[5,22,0]},
                      {"name":"bipedRightLeg","pivot":[-2,12,0]},
                      {
                        "name":"armorRightBoot",
                        "parent":"bipedRightLeg",
                        "pivot":[-2,12,0],
                        "cubes":[
                          {
                            "origin":[-4,0,-2],
                            "size":[4,4,4],
                            "inflate":0.25,
                            "uv":{
                              "north":{"uv":[0,32],"uv_size":[4,4]},
                              "south":{"uv":[4,32],"uv_size":[4,4]}
                            }
                          }
                        ]
                      },
                      {"name":"bipedLeftLeg","pivot":[2,12,0]}
                    ]
                  }]
                }
                """)
            .getAsJsonObject();

    var model = CustomArmorAssetResolver.parseGeometry(root, "example:armor/test");
    assertNotNull(model);
    assertEquals("example:armor/test", model.texture());
    assertEquals(2, model.parts().size());

    var head =
        model.parts().stream().filter(part -> part.parent().equals("head")).findFirst().orElseThrow();
    assertEquals("head", head.slot());
    assertEquals(108, head.positions().length);
    assertEquals(72, head.uvs().length);
    assertRange(head.positions(), 0, -0.25f, 0.25f);
    assertRange(head.positions(), 1, 0f, 0.5f);
    assertRange(head.positions(), 2, -0.25f, 0.25f);

    var boot =
        model.parts().stream()
            .filter(part -> part.parent().equals("rightLeg"))
            .findFirst()
            .orElseThrow();
    assertEquals("feet", boot.slot());
    assertFalse(Arrays.equals(new float[boot.positions().length], boot.positions()));
    assertEquals(36, boot.positions().length, "only the two explicitly mapped faces render");
    assertEquals(24, boot.uvs().length);
  }

  @Test
  void supportsStandardGeckoArmorSegmentBonesWithoutBipedParents() {
    var root =
        JsonParser.parseString(
                """
                {
                  "minecraft:geometry": [{
                    "description": {"texture_width":64,"texture_height":64},
                    "bones": [
                      {
                        "name":"armorHead",
                        "pivot":[0,24,0],
                        "cubes":[{"origin":[-4,24,-4],"size":[8,8,8],"uv":[0,0]}]
                      },
                      {
                        "name":"armorBody",
                        "pivot":[0,24,0],
                        "cubes":[{"origin":[-4,12,-2],"size":[8,12,4],"uv":[16,16]}]
                      },
                      {
                        "name":"armorRightBoot",
                        "pivot":[-2,12,0],
                        "cubes":[{"origin":[-4,0,-2],"size":[4,4,4],"uv":[0,32]}]
                      }
                    ]
                  }]
                }
                """)
            .getAsJsonObject();

    var model = CustomArmorAssetResolver.parseGeometry(root, "example:armor/test");
    assertNotNull(model);
    assertTrue(
        model.parts().stream()
            .anyMatch(part -> part.parent().equals("head") && part.slot().equals("head")));
    assertTrue(
        model.parts().stream()
            .anyMatch(part -> part.parent().equals("torso") && part.slot().equals("chest")));
    assertTrue(
        model.parts().stream()
            .anyMatch(part -> part.parent().equals("rightLeg") && part.slot().equals("feet")));
  }

  @Test
  void reflectsArmorModelApiForwardAxisIntoViewerSpace() {
    var root =
        JsonParser.parseString(
                """
                {
                  "minecraft:geometry": [{
                    "description": {"texture_width":64,"texture_height":64},
                    "bones": [
                      {"name":"bipedBody","pivot":[0,24,0]},
                      {
                        "name":"armorBody",
                        "parent":"bipedBody",
                        "pivot":[0,24,0],
                        "cubes":[
                          {"origin":[-1,20,-5],"size":[2,2,2],"uv":[0,0]}
                        ]
                      }
                    ]
                  }]
                }
                """)
            .getAsJsonObject();

    var model = CustomArmorAssetResolver.parseGeometry(root, "example:armor/test");
    assertNotNull(model);
    var part = model.parts().getFirst();

    // Armor Model API/Minecraft model front is -Z, while the BlueMap avatar's
    // skin front is the Three.js +Z face. The integration boundary reflects Z.
    assertEquals(0.1875f, axisMin(part.positions(), 2), 0.0001f);
    assertEquals(0.3125f, axisMax(part.positions(), 2), 0.0001f);
  }

  @Test
  void matchesArmorModelApiAxisAndRotationConventions() {
    var root =
        JsonParser.parseString(
                """
                {
                  "minecraft:geometry": [{
                    "description": {"texture_width":64,"texture_height":64},
                    "bones": [
                      {"name":"bipedHead","pivot":[0,24,0]},
                      {
                        "name":"hat",
                        "parent":"bipedHead",
                        "pivot":[0,28,0],
                        "rotation":[0,0,90],
                        "cubes":[
                          {"origin":[-6,26,-2],"size":[2,4,4],"uv":[0,0]}
                        ]
                      }
                    ]
                  }]
                }
                """)
            .getAsJsonObject();

    var model = CustomArmorAssetResolver.parseGeometry(root, "example:armor/test");
    assertNotNull(model);
    var part = model.parts().getFirst();

    // ArmorModelAPI preserves authored X and rotation signs. The negative-X
    // cube rotates +90 degrees around Z without an extra mirror.
    assertEquals(-0.125f, axisMin(part.positions(), 0), 0.0001f);
    assertEquals(0.125f, axisMax(part.positions(), 0), 0.0001f);
    assertEquals(-0.125f, axisMin(part.positions(), 1), 0.0001f);
    assertEquals(0.0f, axisMax(part.positions(), 1), 0.0001f);
  }


  @Test
  void assignsConventionalLegBonesToLeggingsSlot() {
    var root =
        JsonParser.parseString(
                """
                {
                  "minecraft:geometry": [{
                    "description": {"texture_width":64,"texture_height":64},
                    "bones": [
                      {"name":"bipedRightLeg","pivot":[-2,12,0]},
                      {
                        "name":"armorRightLeg",
                        "parent":"bipedRightLeg",
                        "pivot":[-2,12,0],
                        "cubes":[{"origin":[-4,0,-2],"size":[4,12,4],"uv":[0,16]}]
                      },
                      {"name":"bipedLeftLeg","pivot":[2,12,0]},
                      {
                        "name":"armorLeftLeg",
                        "parent":"bipedLeftLeg",
                        "pivot":[2,12,0],
                        "cubes":[{"origin":[0,0,-2],"size":[4,12,4],"uv":[16,16]}]
                      }
                    ]
                  }]
                }
                """)
            .getAsJsonObject();

    var model = CustomArmorAssetResolver.parseGeometry(root, "example:armor/test");
    assertNotNull(model);
    assertEquals(2, model.parts().size());
    assertTrue(
        model.parts().stream()
            .allMatch(part -> part.slot().equals("legs")));
    assertTrue(
        model.parts().stream()
            .anyMatch(part -> part.parent().equals("rightLeg")));
    assertTrue(
        model.parts().stream()
            .anyMatch(part -> part.parent().equals("leftLeg")));
  }

  @Test
  void keepsPositiveBedrockXOnPositivePlayerX() {
    var root =
        JsonParser.parseString(
                """
                {
                  "minecraft:geometry": [{
                    "description": {"texture_width":64,"texture_height":64},
                    "bones": [
                      {"name":"bipedBody","pivot":[0,24,0]},
                      {
                        "name":"armorBody",
                        "parent":"bipedBody",
                        "pivot":[0,24,0],
                        "cubes":[
                          {"origin":[2,20,-1],"size":[2,2,2],"uv":[0,0]}
                        ]
                      }
                    ]
                  }]
                }
                """)
            .getAsJsonObject();

    var model = CustomArmorAssetResolver.parseGeometry(root, "example:armor/test");
    assertNotNull(model);
    var part = model.parts().getFirst();
    assertEquals(0.125f, axisMin(part.positions(), 0), 0.0001f);
    assertEquals(0.25f, axisMax(part.positions(), 0), 0.0001f);
  }

  @Test
  void assignsArmorWaistToLegsButParentsItToTorso() {
    var root =
        JsonParser.parseString(
                """
                {
                  "minecraft:geometry": [{
                    "description": {"texture_width":64,"texture_height":64},
                    "bones": [{
                      "name":"armorWaist",
                      "pivot":[0,24,0],
                      "cubes":[{"origin":[-4,10,-2],"size":[8,4,4],"uv":[0,0]}]
                    }]
                  }]
                }
                """)
            .getAsJsonObject();

    var model = CustomArmorAssetResolver.parseGeometry(root, "example:armor/test");
    assertNotNull(model);
    var waist = model.parts().getFirst();
    assertEquals("torso", waist.parent());
    assertEquals("legs", waist.slot());
  }

  @Test
  void resolvesBuiltInSharedArmorGeometryFamilies() {
    var compatibility = EquipmentCompatibilityConfig.defaults();

    assertEquals("tirisfal_robe", compatibility.geometryFamily("armory_rpgs", "astral_robe"));
    assertEquals("tempest_robe", compatibility.geometryFamily("armory_rpgs", "rimeweave_robe"));
    assertEquals("warrior_armor", compatibility.geometryFamily("rogues", "berserker_armor"));
    assertEquals("rogue_armor", compatibility.geometryFamily("rogues", "assassin_armor"));
    assertEquals("ranger_armor", compatibility.geometryFamily("archers", "netherite_ranger_armor"));
    assertEquals("paladin_armor", compatibility.geometryFamily("paladins", "crusader_armor"));
    assertEquals("priest_robes", compatibility.geometryFamily("paladins", "prior_robe"));
    assertEquals("wizard_robes", compatibility.geometryFamily("wizards", "frost_robe"));
    assertEquals("unrelated_armor", compatibility.geometryFamily("example", "unrelated_armor"));
  }

  @Test
  void discoversSegmentedHumanoidArmorLayersAndDyeOverlays() {
    var available =
        Set.of(
            "assets/immersive_armors/textures/models/armor/robe/body_lower.png",
            "assets/immersive_armors/textures/models/armor/robe/body_lower_overlay.png",
            "assets/immersive_armors/textures/models/armor/robe/body_middle.png",
            "assets/immersive_armors/textures/models/armor/robe/leggings_lower.png",
            "assets/immersive_armors/textures/models/armor/robe/leggings_middle.png");

    var chest =
        CustomArmorAssetResolver.layeredModel(
            "immersive_armors", "robe", false, available::contains);
    assertNotNull(chest);
    assertEquals(1, chest.layer());
    assertEquals(2, chest.layers().size());
    assertEquals(0.25f, chest.layers().getFirst().deformation(), 0.0001f);
    assertEquals(0.55f, chest.layers().getFirst().headDeformation(), 0.0001f);
    assertTrue(chest.layers().getFirst().dyeable());
    assertNotNull(chest.layers().getFirst().overlayTexture());

    var legs =
        CustomArmorAssetResolver.layeredModel(
            "immersive_armors", "robe", true, available::contains);
    assertNotNull(legs);
    assertEquals(2, legs.layer());
    assertEquals(2, legs.layers().size());
    assertEquals(0.125f, legs.layers().getFirst().deformation(), 0.0001f);
    assertEquals(0.5f, legs.layers().get(1).deformation(), 0.0001f);
  }

  private static void assertRange(
      float[] positions, int axis, float expectedMin, float expectedMax) {
    assertEquals(expectedMin, axisMin(positions, axis), 0.0001f);
    assertEquals(expectedMax, axisMax(positions, axis), 0.0001f);
  }

  private static float axisMin(float[] positions, int axis) {
    float result = Float.POSITIVE_INFINITY;
    for (int i = axis; i < positions.length; i += 3) result = Math.min(result, positions[i]);
    return result;
  }

  private static float axisMax(float[] positions, int axis) {
    float result = Float.NEGATIVE_INFINITY;
    for (int i = axis; i < positions.length; i += 3) result = Math.max(result, positions[i]);
    return result;
  }
}
