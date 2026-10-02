package dev.playerhistory.bluemap;

import static org.junit.jupiter.api.Assertions.*;

import com.google.gson.JsonParser;
import java.util.Arrays;
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
  void appliesGeckoAxisAndRotationConventions() {
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

    // The source cube sits on negative Bedrock X. Gecko/Minecraft mirrors X,
    // then the +90-degree Z rotation moves that positive-X offset upward.
    assertEquals(-0.125f, axisMin(part.positions(), 0), 0.0001f);
    assertEquals(0.125f, axisMax(part.positions(), 0), 0.0001f);
    assertEquals(0.5f, axisMin(part.positions(), 1), 0.0001f);
    assertEquals(0.625f, axisMax(part.positions(), 1), 0.0001f);
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
