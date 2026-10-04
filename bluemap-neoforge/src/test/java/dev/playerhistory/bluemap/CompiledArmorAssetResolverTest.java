package dev.playerhistory.bluemap;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;

final class CompiledArmorAssetResolverTest {
  private static final String BUILDERS = "net/minecraft/client/model/geom/builders/";

  @Test
  void decodesBlockbenchCreateBodyLayerWithoutLoadingClientClasses() {
    var model = CompiledArmorAssetResolver.decodeModel(generatedTorsoModel(), "chest");

    assertNotNull(model);
    assertEquals(1, model.parts().size());
    var part = model.parts().getFirst();
    assertEquals("torso", part.parent());
    assertEquals("chest", part.slot());
    assertEquals(108, part.positions().length);
    assertEquals(72, part.uvs().length);

    assertEquals(-0.25f, axisMin(part.positions(), 0), 0.0001f);
    assertEquals(0.25f, axisMax(part.positions(), 0), 0.0001f);
    assertEquals(-0.75f, axisMin(part.positions(), 1), 0.0001f);
    assertEquals(0f, axisMax(part.positions(), 1), 0.0001f);
    assertEquals(-0.125f, axisMin(part.positions(), 2), 0.0001f);
    assertEquals(0.125f, axisMax(part.positions(), 2), 0.0001f);
    for (float uv : part.uvs()) assertTrue(uv >= 0f && uv <= 1f);
  }

  private static byte[] generatedTorsoModel() {
    var writer = new ClassWriter(0);
    writer.visit(
        Opcodes.V17,
        Opcodes.ACC_PUBLIC,
        "net/mcreator/example/client/model/ModelTest",
        null,
        "java/lang/Object",
        null);

    MethodVisitor method =
        writer.visitMethod(
            Opcodes.ACC_PUBLIC | Opcodes.ACC_STATIC,
            "createBodyLayer",
            "()L" + BUILDERS + "LayerDefinition;",
            null,
            null);
    method.visitCode();

    method.visitTypeInsn(Opcodes.NEW, BUILDERS + "MeshDefinition");
    method.visitInsn(Opcodes.DUP);
    method.visitMethodInsn(
        Opcodes.INVOKESPECIAL, BUILDERS + "MeshDefinition", "<init>", "()V", false);
    method.visitVarInsn(Opcodes.ASTORE, 0);

    method.visitVarInsn(Opcodes.ALOAD, 0);
    method.visitMethodInsn(
        Opcodes.INVOKEVIRTUAL,
        BUILDERS + "MeshDefinition",
        "getRoot",
        "()L" + BUILDERS + "PartDefinition;",
        false);
    method.visitVarInsn(Opcodes.ASTORE, 1);

    method.visitVarInsn(Opcodes.ALOAD, 1);
    method.visitLdcInsn("torso");
    method.visitMethodInsn(
        Opcodes.INVOKESTATIC,
        BUILDERS + "CubeListBuilder",
        "create",
        "()L" + BUILDERS + "CubeListBuilder;",
        false);
    method.visitIntInsn(Opcodes.BIPUSH, 16);
    method.visitIntInsn(Opcodes.BIPUSH, 16);
    method.visitMethodInsn(
        Opcodes.INVOKEVIRTUAL,
        BUILDERS + "CubeListBuilder",
        "texOffs",
        "(II)L" + BUILDERS + "CubeListBuilder;",
        false);

    method.visitLdcInsn(-4f);
    method.visitLdcInsn(0f);
    method.visitLdcInsn(-2f);
    method.visitLdcInsn(8f);
    method.visitLdcInsn(12f);
    method.visitLdcInsn(4f);
    method.visitTypeInsn(Opcodes.NEW, BUILDERS + "CubeDeformation");
    method.visitInsn(Opcodes.DUP);
    method.visitInsn(Opcodes.FCONST_0);
    method.visitMethodInsn(
        Opcodes.INVOKESPECIAL,
        BUILDERS + "CubeDeformation",
        "<init>",
        "(F)V",
        false);
    method.visitMethodInsn(
        Opcodes.INVOKEVIRTUAL,
        BUILDERS + "CubeListBuilder",
        "addBox",
        "(FFFFFFL" + BUILDERS + "CubeDeformation;)L" + BUILDERS + "CubeListBuilder;",
        false);

    method.visitInsn(Opcodes.FCONST_0);
    method.visitInsn(Opcodes.FCONST_0);
    method.visitInsn(Opcodes.FCONST_0);
    method.visitMethodInsn(
        Opcodes.INVOKESTATIC,
        "net/minecraft/client/model/geom/PartPose",
        "offset",
        "(FFF)Lnet/minecraft/client/model/geom/PartPose;",
        false);
    method.visitMethodInsn(
        Opcodes.INVOKEVIRTUAL,
        BUILDERS + "PartDefinition",
        "addOrReplaceChild",
        "(Ljava/lang/String;L"
            + BUILDERS
            + "CubeListBuilder;Lnet/minecraft/client/model/geom/PartPose;)L"
            + BUILDERS
            + "PartDefinition;",
        false);
    method.visitInsn(Opcodes.POP);

    method.visitVarInsn(Opcodes.ALOAD, 0);
    method.visitIntInsn(Opcodes.BIPUSH, 64);
    method.visitIntInsn(Opcodes.BIPUSH, 64);
    method.visitMethodInsn(
        Opcodes.INVOKESTATIC,
        BUILDERS + "LayerDefinition",
        "create",
        "(L" + BUILDERS + "MeshDefinition;II)L" + BUILDERS + "LayerDefinition;",
        false);
    method.visitInsn(Opcodes.ARETURN);
    method.visitMaxs(16, 2);
    method.visitEnd();
    writer.visitEnd();
    return writer.toByteArray();
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
