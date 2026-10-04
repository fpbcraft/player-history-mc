package dev.playerhistory.bluemap;

import dev.playerhistory.core.LogSink;
import java.io.IOException;
import java.nio.file.*;
import java.util.*;
import java.util.zip.ZipFile;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.ArmorItem;
import net.neoforged.fml.ModList;
import org.objectweb.asm.*;

/**
 * Extracts Blockbench/MCreator-style Java armor geometry without loading client classes.
 *
 * <p>Generated armor models commonly keep their geometry in a static {@code createBodyLayer()}
 * method under {@code client/model}. Dedicated servers cannot load those classes because they
 * reference Minecraft client types, but their class bytes are still present in the installed mod
 * jar. This resolver interprets the small CubeListBuilder/PartPose instruction subset emitted by
 * Blockbench and MCreator and converts it into Player History's existing custom-armor triangles.
 */
final class CompiledArmorAssetResolver {
  record Part(String parent, String slot, float[] positions, float[] uvs) {}
  record Model(List<Part> parts) {}

  private static final Object UNKNOWN = new Object();
  private static final String MODEL_PATH = "/client/model/";
  private static final int MIN_FALLBACK_SCORE = 180;

  private final LogSink log;
  private final Map<String, List<Container>> containersByNamespace = new HashMap<>();
  private final Map<String, Optional<ClassSource>> selectionCache = new HashMap<>();
  private final Map<String, Optional<ParsedModel>> parsedCache = new HashMap<>();

  CompiledArmorAssetResolver(LogSink log) {
    this.log = log;
    indexInstalledMods();
  }

  Model resolve(ResourceLocation item, ArmorItem.Type type) {
    String slot = slot(type);
    if (slot == null) return null;
    String family = family(item.getPath());
    String selectionKey = item.getNamespace() + ":" + family;
    Optional<ClassSource> selected =
        selectionCache.computeIfAbsent(
            selectionKey, ignored -> Optional.ofNullable(select(item.getNamespace(), family)));
    if (selected.isEmpty()) return null;

    ClassSource source = selected.get();
    Optional<ParsedModel> parsed =
        parsedCache.computeIfAbsent(source.key(), ignored -> Optional.ofNullable(parse(source)));
    if (parsed.isEmpty()) return null;

    List<Part> parts = parsed.get().bake(slot);
    if (parts.isEmpty()) return null;
    log.debug(
        "Resolved compiled armor model "
            + item
            + " from "
            + source.entry()
            + " ("
            + parts.size()
            + " part(s))");
    return new Model(parts);
  }

  private void indexInstalledMods() {
    int models = 0;
    try {
      ModList modList = ModList.get();
      if (modList == null) return;
      for (var info : modList.getModFiles()) {
        var file = info.getFile();
        if (file == null || file.getFilePath() == null) continue;
        Path path = file.getFilePath();
        try {
          Container container = indexContainer(path);
          if (container == null || container.models().isEmpty()) continue;
          models += container.models().size();
          for (String namespace : container.namespaces()) {
            containersByNamespace
                .computeIfAbsent(namespace, ignored -> new ArrayList<>())
                .add(container);
          }
        } catch (IOException | RuntimeException ignored) {
          // One unusual mod container must not disable discovery for the rest.
        }
      }
    } catch (RuntimeException error) {
      log.warn("Could not index compiled armor models: " + error);
      return;
    }
    if (models > 0) log.debug("Indexed " + models + " compiled client model candidate(s)");
  }

  private static Container indexContainer(Path path) throws IOException {
    Set<String> namespaces = new LinkedHashSet<>();
    List<ClassSource> models = new ArrayList<>();
    List<ClassSource> classes = new ArrayList<>();
    boolean directory = Files.isDirectory(path);

    if (directory) {
      try (var stream = Files.walk(path)) {
        for (Path entry : stream.filter(Files::isRegularFile).toList()) {
          String relative = path.relativize(entry).toString().replace('\', '/');
          indexEntry(path, true, relative, namespaces, models, classes);
        }
      }
    } else if (Files.isRegularFile(path)) {
      try (var zip = new ZipFile(path.toFile())) {
        var entries = zip.entries();
        while (entries.hasMoreElements()) {
          var entry = entries.nextElement();
          if (!entry.isDirectory())
            indexEntry(path, false, entry.getName(), namespaces, models, classes);
        }
      }
    } else {
      return null;
    }

    return models.isEmpty()
        ? null
        : new Container(
            path,
            directory,
            Set.copyOf(namespaces),
            List.copyOf(models),
            List.copyOf(classes));
  }

  private static void indexEntry(
      Path container,
      boolean directory,
      String entry,
      Set<String> namespaces,
      List<ClassSource> models,
      List<ClassSource> classes) {
    if (entry.startsWith("assets/")) {
      int slash = entry.indexOf('/', "assets/".length());
      if (slash > "assets/".length())
        namespaces.add(entry.substring("assets/".length(), slash));
    }
    if (!entry.endsWith(".class") || entry.equals("module-info.class")) return;
    ClassSource source = new ClassSource(container, directory, entry);
    classes.add(source);
    if (entry.contains(MODEL_PATH) && !entry.substring(entry.lastIndexOf('/') + 1).contains("$"))
      models.add(source);
  }

  private ClassSource select(String namespace, String family) {
    List<Container> containers = containersByNamespace.getOrDefault(namespace, List.of());
    if (containers.isEmpty()) return null;

    Set<String> linked = new LinkedHashSet<>();
    for (Container container : containers) {
      Set<String> modelNames = new HashSet<>();
      for (ClassSource model : container.models()) modelNames.add(model.internalName());
      for (ClassSource source : container.classes()) {
        if (!likelyItemClass(source.entry(), family)) continue;
        linked.addAll(referencedModels(source, modelNames));
      }
    }

    List<ClassSource> candidates = new ArrayList<>();
    for (Container container : containers) {
      for (ClassSource model : container.models()) {
        if (linked.isEmpty() || linked.contains(model.internalName())) candidates.add(model);
      }
    }
    if (linked.size() == 1 && candidates.size() == 1) return candidates.getFirst();
    ClassSource linkedWinner = best(family, candidates, linked.isEmpty() ? MIN_FALLBACK_SCORE : 1);
    if (linkedWinner != null) return linkedWinner;

    if (!linked.isEmpty()) {
      // A generated item can reference helper/client classes in addition to the model. If the
      // direct-link set remained ambiguous, do one conservative name-based pass over all models.
      candidates.clear();
      for (Container container : containers) candidates.addAll(container.models());
    }
    return best(family, candidates, MIN_FALLBACK_SCORE);
  }

  private static boolean likelyItemClass(String entry, String family) {
    if (!entry.endsWith(".class") || entry.contains(MODEL_PATH)) return false;
    String simple = entry.substring(entry.lastIndexOf('/') + 1, entry.length() - 6);
    String compactClass = compact(simple.replace("Item", ""));
    String compactFamily = compact(family);
    return !compactFamily.isEmpty()
        && (compactClass.contains(compactFamily) || compactFamily.contains(compactClass));
  }

  private Set<String> referencedModels(ClassSource source, Set<String> knownModels) {
    if (knownModels.isEmpty()) return Set.of();
    Set<String> references = new LinkedHashSet<>();
    try {
      new ClassReader(source.read())
          .accept(
              new ClassVisitor(Opcodes.ASM9) {
                @Override
                public MethodVisitor visitMethod(
                    int access,
                    String name,
                    String descriptor,
                    String signature,
                    String[] exceptions) {
                  return new MethodVisitor(Opcodes.ASM9) {
                    private void add(String owner) {
                      if (owner != null && knownModels.contains(owner)) references.add(owner);
                    }

                    @Override
                    public void visitTypeInsn(int opcode, String type) {
                      add(type);
                    }

                    @Override
                    public void visitFieldInsn(
                        int opcode, String owner, String name, String descriptor) {
                      add(owner);
                      Type field = Type.getType(descriptor);
                      if (field.getSort() == Type.OBJECT) add(field.getInternalName());
                    }

                    @Override
                    public void visitMethodInsn(
                        int opcode,
                        String owner,
                        String name,
                        String descriptor,
                        boolean isInterface) {
                      add(owner);
                    }
                  };
                }
              },
              ClassReader.SKIP_DEBUG | ClassReader.SKIP_FRAMES);
    } catch (IOException | RuntimeException ignored) {
      return Set.of();
    }
    return references;
  }

  private static ClassSource best(String family, List<ClassSource> candidates, int minimumScore) {
    ClassSource winner = null;
    int winnerScore = 0;
    boolean tied = false;
    for (ClassSource candidate : candidates) {
      int score = score(family, modelName(candidate.entry()));
      if (score > winnerScore) {
        winner = candidate;
        winnerScore = score;
        tied = false;
      } else if (score > 0 && score == winnerScore) {
        tied = true;
      }
    }
    return winnerScore >= minimumScore && !tied ? winner : null;
  }

  private ParsedModel parse(ClassSource source) {
    try {
      byte[] bytes = source.read();
      LayerMethodInterpreter interpreter = new LayerMethodInterpreter();
      final boolean[] found = {false};
      new ClassReader(bytes)
          .accept(
              new ClassVisitor(Opcodes.ASM9) {
                @Override
                public MethodVisitor visitMethod(
                    int access,
                    String name,
                    String descriptor,
                    String signature,
                    String[] exceptions) {
                  if (name.equals("createBodyLayer") && (access & Opcodes.ACC_STATIC) != 0) {
                    found[0] = true;
                    return interpreter;
                  }
                  return null;
                }
              },
              ClassReader.SKIP_DEBUG | ClassReader.SKIP_FRAMES);
      return found[0] && interpreter.valid() ? interpreter.model() : null;
    } catch (IOException | RuntimeException error) {
      log.debug("Could not decode compiled armor model " + source.entry() + ": " + error);
      return null;
    }
  }

  private static String slot(ArmorItem.Type type) {
    if (type == ArmorItem.Type.HELMET) return "head";
    if (type == ArmorItem.Type.CHESTPLATE) return "chest";
    if (type == ArmorItem.Type.LEGGINGS) return "legs";
    if (type == ArmorItem.Type.BOOTS) return "feet";
    return null;
  }

  private static String family(String path) {
    for (String suffix :
        List.of(
            "_chestplate", "_leggings", "_helmet", "_boots",
            "_chest", "_legs", "_head", "_feet")) {
      if (path.endsWith(suffix)) return path.substring(0, path.length() - suffix.length());
    }
    return path;
  }

  private static String modelName(String entry) {
    String simple = entry.substring(entry.lastIndexOf('/') + 1, entry.length() - 6);
    if (simple.regionMatches(true, 0, "Model", 0, 5)) simple = simple.substring(5);
    return simple;
  }

  private static int score(String family, String candidate) {
    String a = compact(family);
    String b = compact(candidate);
    if (a.isEmpty() || b.isEmpty()) return 0;
    if (a.equals(b)) return 1000;
    if (a.contains(b) || b.contains(a)) return 220;

    Set<String> left = tokens(family);
    Set<String> right = tokens(candidate);
    int score = 0;
    for (String token : left) if (right.contains(token)) score += token.length() >= 5 ? 35 : 15;
    return score;
  }

  private static String compact(String value) {
    return value.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
  }

  private static Set<String> tokens(String value) {
    Set<String> result = new LinkedHashSet<>();
    for (String token : value.toLowerCase(Locale.ROOT).split("[^a-z0-9]+"))
      if (!token.isBlank() && !Set.of("model", "armor", "armour", "item").contains(token))
        result.add(token);
    return result;
  }

  private record Container(
      Path path,
      boolean directory,
      Set<String> namespaces,
      List<ClassSource> models,
      List<ClassSource> classes) {}

  private record ClassSource(Path container, boolean directory, String entry) {
    String key() {
      return container.toAbsolutePath().normalize() + "!" + entry;
    }

    String internalName() {
      return entry.substring(0, entry.length() - ".class".length());
    }

    byte[] read() throws IOException {
      if (directory) return Files.readAllBytes(container.resolve(entry));
      try (var zip = new ZipFile(container.toFile())) {
        var zipEntry = zip.getEntry(entry);
        if (zipEntry == null) throw new IOException("Missing class entry " + entry);
        try (var input = zip.getInputStream(zipEntry)) {
          return input.readAllBytes();
        }
      }
    }
  }

  private record Pose(float x, float y, float z, float xRot, float yRot, float zRot) {
    static final Pose ZERO = new Pose(0, 0, 0, 0, 0, 0);
  }

  private record Cube(
      float x,
      float y,
      float z,
      float dx,
      float dy,
      float dz,
      float inflate,
      int u,
      int v,
      boolean mirror) {}

  private static final class PartNode {
    final String name;
    final Pose pose;
    final List<Cube> cubes;
    final List<PartNode> children = new ArrayList<>();

    PartNode(String name, Pose pose, List<Cube> cubes) {
      this.name = name;
      this.pose = pose;
      this.cubes = cubes;
    }
  }

  private record ParsedModel(PartNode root, int textureWidth, int textureHeight) {
    List<Part> bake(String slot) {
      List<Part> result = new ArrayList<>();
      int roots = root.children.size();
      for (PartNode child : root.children) {
        String parent = semanticParent(child, slot, roots);
        if (parent == null) continue;
        TriangleBuilder triangles = new TriangleBuilder(textureWidth, textureHeight);
        append(child, child, triangles, List.of());
        if (!triangles.empty())
          result.add(new Part(parent, slot, triangles.positions(), triangles.uvs()));
      }
      return List.copyOf(result);
    }

    private static void append(
        PartNode semanticRoot,
        PartNode node,
        TriangleBuilder out,
        List<Pose> transforms) {
      List<Pose> currentTransforms = transforms;
      if (node != semanticRoot) {
        currentTransforms = new ArrayList<>(transforms.size() + 1);
        currentTransforms.add(node.pose);
        currentTransforms.addAll(transforms);
      }
      for (Cube cube : node.cubes) out.cube(cube, currentTransforms);
      for (PartNode child : node.children) append(semanticRoot, child, out, currentTransforms);
    }

    private static String semanticParent(PartNode part, String slot, int rootCount) {
      String name = compact(part.name);
      if (containsAny(name, "rightarm", "armright", "rightsleeve")) return "rightArm";
      if (containsAny(name, "leftarm", "armleft", "leftsleeve")) return "leftArm";
      if (containsAny(name, "rightleg", "legright", "rightboot", "rightfoot"))
        return "rightLeg";
      if (containsAny(name, "leftleg", "legleft", "leftboot", "leftfoot"))
        return "leftLeg";
      if (containsAny(name, "head", "helmet", "hat", "hood", "mask")) return "head";
      if (containsAny(name, "body", "torso", "chest", "jacket", "coat", "waist", "belt"))
        return "torso";

      if (slot.equals("head")) return "head";
      if (slot.equals("chest")) {
        if (part.pose.x() <= -3f) return "rightArm";
        if (part.pose.x() >= 3f) return "leftArm";
        return rootCount == 1 || Math.abs(part.pose.x()) < 3f ? "torso" : null;
      }
      if (slot.equals("legs") || slot.equals("feet")) {
        if (part.pose.x() < -0.5f) return "rightLeg";
        if (part.pose.x() > 0.5f) return "leftLeg";
        return slot.equals("legs") ? "torso" : (rootCount == 1 ? "rightLeg" : null);
      }
      return null;
    }

    private static boolean containsAny(String value, String... candidates) {
      for (String candidate : candidates) if (value.contains(candidate)) return true;
      return false;
    }
  }

  private static final class MeshValue {
    final PartNode root = new PartNode("root", Pose.ZERO, List.of());
  }

  private record PartValue(PartNode node) {}

  private static final class BuilderValue {
    final List<Cube> cubes = new ArrayList<>();
    int u;
    int v;
    boolean mirror;
  }

  private record DeformationValue(float amount) {}
  private record PoseValue(Pose pose) {}

  private static final class NewValue {
    final String type;
    Object value = UNKNOWN;

    NewValue(String type) {
      this.type = type;
    }
  }

  private static final class LayerMethodInterpreter extends MethodVisitor {
    private final Deque<Object> stack = new ArrayDeque<>();
    private final Map<Integer, Object> locals = new HashMap<>();
    private MeshValue mesh;
    private int textureWidth = 64;
    private int textureHeight = 64;
    private boolean failed;

    LayerMethodInterpreter() {
      super(Opcodes.ASM9);
    }

    boolean valid() {
      return !failed && mesh != null && !mesh.root.children.isEmpty();
    }

    ParsedModel model() {
      return new ParsedModel(mesh.root, textureWidth, textureHeight);
    }

    @Override
    public void visitInsn(int opcode) {
      switch (opcode) {
        case Opcodes.ACONST_NULL -> push(UNKNOWN);
        case Opcodes.ICONST_M1 -> push(-1);
        case Opcodes.ICONST_0 -> push(0);
        case Opcodes.ICONST_1 -> push(1);
        case Opcodes.ICONST_2 -> push(2);
        case Opcodes.ICONST_3 -> push(3);
        case Opcodes.ICONST_4 -> push(4);
        case Opcodes.ICONST_5 -> push(5);
        case Opcodes.FCONST_0 -> push(0f);
        case Opcodes.FCONST_1 -> push(1f);
        case Opcodes.FCONST_2 -> push(2f);
        case Opcodes.DUP -> push(peek());
        case Opcodes.POP -> pop();
        case Opcodes.SWAP -> {
          Object first = pop();
          Object second = pop();
          push(first);
          push(second);
        }
        case Opcodes.I2F -> push(number(pop()).floatValue());
        case Opcodes.FNEG -> push(-number(pop()).floatValue());
        case Opcodes.INEG -> push(-number(pop()).intValue());
        default -> {
        }
      }
    }

    @Override
    public void visitIntInsn(int opcode, int operand) {
      if (opcode == Opcodes.BIPUSH || opcode == Opcodes.SIPUSH) push(operand);
      else push(UNKNOWN);
    }

    @Override
    public void visitLdcInsn(Object value) {
      push(value instanceof Number || value instanceof String ? value : UNKNOWN);
    }

    @Override
    public void visitVarInsn(int opcode, int var) {
      switch (opcode) {
        case Opcodes.ALOAD, Opcodes.ILOAD, Opcodes.FLOAD -> push(locals.getOrDefault(var, UNKNOWN));
        case Opcodes.ASTORE, Opcodes.ISTORE, Opcodes.FSTORE -> locals.put(var, pop());
        default -> {
        }
      }
    }

    @Override
    public void visitTypeInsn(int opcode, String type) {
      if (opcode == Opcodes.NEW) push(new NewValue(type));
    }

    @Override
    public void visitFieldInsn(int opcode, String owner, String name, String descriptor) {
      if (opcode == Opcodes.GETSTATIC
          && owner.equals("net/minecraft/client/model/geom/PartPose")
          && name.equals("ZERO")) {
        push(new PoseValue(Pose.ZERO));
      } else if (opcode == Opcodes.GETSTATIC) {
        push(UNKNOWN);
      } else if (opcode == Opcodes.GETFIELD) {
        pop();
        push(UNKNOWN);
      } else if (opcode == Opcodes.PUTSTATIC) {
        pop();
      } else if (opcode == Opcodes.PUTFIELD) {
        pop();
        pop();
      }
    }

    @Override
    public void visitMethodInsn(
        int opcode,
        String owner,
        String name,
        String descriptor,
        boolean isInterface) {
      Type[] argumentTypes = Type.getArgumentTypes(descriptor);
      Object[] args = new Object[argumentTypes.length];
      for (int i = args.length - 1; i >= 0; i--) args[i] = pop();
      Object receiver = opcode == Opcodes.INVOKESTATIC ? null : pop();
      Object result = invoke(owner, name, receiver, args);
      if (Type.getReturnType(descriptor).getSort() != Type.VOID) push(result);
    }

    private Object invoke(String owner, String name, Object receiver, Object[] args) {
      if (name.equals("<init>")) {
        NewValue created = receiver instanceof NewValue value ? value : null;
        if (created != null) {
          if (owner.equals("net/minecraft/client/model/geom/builders/MeshDefinition")) {
            created.value = mesh = new MeshValue();
          } else if (owner.equals("net/minecraft/client/model/geom/builders/CubeDeformation")) {
            created.value = new DeformationValue(floatArg(args, 0, 0));
          }
        }
        return UNKNOWN;
      }

      Object unwrapped = unwrap(receiver);
      if (owner.equals("net/minecraft/client/model/geom/builders/MeshDefinition")
          && name.equals("getRoot")
          && unwrapped instanceof MeshValue value) {
        return new PartValue(value.root);
      }

      if (owner.equals("net/minecraft/client/model/geom/builders/CubeListBuilder")) {
        if (name.equals("create")) return new BuilderValue();
        if (!(unwrapped instanceof BuilderValue builder)) return UNKNOWN;
        if (name.equals("texOffs") && args.length >= 2) {
          builder.u = intArg(args, 0, builder.u);
          builder.v = intArg(args, 1, builder.v);
        } else if (name.equals("mirror")) {
          builder.mirror = args.length == 0 || boolArg(args, 0, true);
        } else if (name.equals("addBox")) {
          addBox(builder, args);
        }
        return builder;
      }

      if (owner.equals("net/minecraft/client/model/geom/PartPose")) {
        if (name.equals("offset") && args.length >= 3)
          return new PoseValue(
              new Pose(
                  floatArg(args, 0, 0),
                  floatArg(args, 1, 0),
                  floatArg(args, 2, 0),
                  0,
                  0,
                  0));
        if (name.equals("offsetAndRotation") && args.length >= 6)
          return new PoseValue(
              new Pose(
                  floatArg(args, 0, 0),
                  floatArg(args, 1, 0),
                  floatArg(args, 2, 0),
                  floatArg(args, 3, 0),
                  floatArg(args, 4, 0),
                  floatArg(args, 5, 0)));
      }

      if (owner.equals("net/minecraft/client/model/geom/builders/PartDefinition")
          && name.equals("addOrReplaceChild")
          && unwrapped instanceof PartValue parent
          && args.length >= 3) {
        String childName = args[0] instanceof String value ? value : "part";
        BuilderValue builder = value(args[1], BuilderValue.class);
        PoseValue pose = value(args[2], PoseValue.class);
        if (builder == null || pose == null) return UNKNOWN;
        PartNode child = new PartNode(childName, pose.pose(), List.copyOf(builder.cubes));
        parent.node().children.add(child);
        return new PartValue(child);
      }

      if (owner.equals("net/minecraft/client/model/geom/builders/LayerDefinition")
          && name.equals("create")
          && args.length >= 3) {
        MeshValue candidate = value(args[0], MeshValue.class);
        if (candidate != null) mesh = candidate;
        textureWidth = intArg(args, args.length - 2, textureWidth);
        textureHeight = intArg(args, args.length - 1, textureHeight);
        return UNKNOWN;
      }
      return UNKNOWN;
    }

    private void addBox(BuilderValue builder, Object[] args) {
      List<Float> numbers = new ArrayList<>();
      float deformation = 0;
      for (Object argument : args) {
        Object value = unwrap(argument);
        if (value instanceof Number number) numbers.add(number.floatValue());
        else if (value instanceof DeformationValue deform) deformation = deform.amount();
      }
      if (numbers.size() < 6) return;
      builder.cubes.add(
          new Cube(
              numbers.get(0),
              numbers.get(1),
              numbers.get(2),
              numbers.get(3),
              numbers.get(4),
              numbers.get(5),
              deformation,
              builder.u,
              builder.v,
              builder.mirror));
    }

    private void push(Object value) {
      stack.push(value == null ? UNKNOWN : value);
    }

    private Object pop() {
      if (stack.isEmpty()) {
        failed = true;
        return UNKNOWN;
      }
      return stack.pop();
    }

    private Object peek() {
      if (stack.isEmpty()) {
        failed = true;
        return UNKNOWN;
      }
      return stack.peek();
    }

    private static Object unwrap(Object value) {
      if (value instanceof NewValue created && created.value != UNKNOWN) return created.value;
      return value;
    }

    private static Number number(Object value) {
      Object unwrapped = unwrap(value);
      return unwrapped instanceof Number number ? number : 0;
    }

    private static float floatArg(Object[] args, int index, float fallback) {
      if (index < 0 || index >= args.length) return fallback;
      Object value = unwrap(args[index]);
      return value instanceof Number number ? number.floatValue() : fallback;
    }

    private static int intArg(Object[] args, int index, int fallback) {
      if (index < 0 || index >= args.length) return fallback;
      Object value = unwrap(args[index]);
      return value instanceof Number number ? number.intValue() : fallback;
    }

    private static boolean boolArg(Object[] args, int index, boolean fallback) {
      if (index < 0 || index >= args.length) return fallback;
      Object value = unwrap(args[index]);
      return value instanceof Number number ? number.intValue() != 0 : fallback;
    }

    private static <T> T value(Object value, Class<T> type) {
      Object unwrapped = unwrap(value);
      return type.isInstance(unwrapped) ? type.cast(unwrapped) : null;
    }
  }

  private static final class TriangleBuilder {
    private final int textureWidth;
    private final int textureHeight;
    private final ArrayList<Float> positions = new ArrayList<>();
    private final ArrayList<Float> uvs = new ArrayList<>();

    TriangleBuilder(int textureWidth, int textureHeight) {
      this.textureWidth = Math.max(1, textureWidth);
      this.textureHeight = Math.max(1, textureHeight);
    }

    boolean empty() {
      return positions.isEmpty();
    }

    void cube(Cube cube, List<Pose> transforms) {
      float inflate = cube.inflate();
      float x0 = cube.x() - inflate;
      float y0 = cube.y() - inflate;
      float z0 = cube.z() - inflate;
      float x1 = cube.x() + cube.dx() + inflate;
      float y1 = cube.y() + cube.dy() + inflate;
      float z1 = cube.z() + cube.dz() + inflate;
      float[][] vertices = {
        {x0, y0, z0},
        {x0, y0, z1},
        {x0, y1, z0},
        {x0, y1, z1},
        {x1, y1, z0},
        {x1, y1, z1},
        {x1, y0, z0},
        {x1, y0, z1}
      };
      for (float[] vertex : vertices) {
        for (Pose pose : transforms) applyPose(vertex, pose);
        vertex[0] /= 16f;
        vertex[1] = -vertex[1] / 16f;
        vertex[2] = -vertex[2] / 16f;
      }

      float u = cube.u();
      float v = cube.v();
      float w = Math.max(0, cube.dx());
      float h = Math.max(0, cube.dy());
      float d = Math.max(0, cube.dz());
      float[][] top = rect(u + d, v, w, d, cube.mirror());
      float[][] bottom = rect(u + d + w, v, w, d, cube.mirror());
      float[][] left = rect(u, v + d, d, h, cube.mirror());
      float[][] front = rect(u + d, v + d, w, h, cube.mirror());
      float[][] right = rect(u + d + w, v + d, d, h, cube.mirror());
      float[][] back = rect(u + d * 2 + w, v + d, w, h, cube.mirror());

      face(vertices, new int[] {4, 5, 7, 6}, ordered(right, false));
      face(vertices, new int[] {3, 2, 0, 1}, ordered(left, false));
      face(vertices, new int[] {0, 6, 7, 1}, ordered(top, false));
      face(vertices, new int[] {3, 5, 4, 2}, ordered(bottom, true));
      face(vertices, new int[] {2, 4, 6, 0}, ordered(front, false));
      face(vertices, new int[] {5, 3, 1, 7}, ordered(back, false));
    }

    private void face(float[][] vertices, int[] corners, float[][] uv) {
      int[] triangles = {0, 1, 2, 0, 2, 3};
      for (int index : triangles) {
        float[] vertex = vertices[corners[index]];
        positions.add(vertex[0]);
        positions.add(vertex[1]);
        positions.add(vertex[2]);
        uvs.add(uv[index][0]);
        uvs.add(uv[index][1]);
      }
    }

    private float[][] rect(float u, float v, float width, float height, boolean mirror) {
      float u0 = u / textureWidth;
      float u1 = (u + width) / textureWidth;
      float v0 = 1f - v / textureHeight;
      float v1 = 1f - (v + height) / textureHeight;
      if (mirror) {
        float swap = u0;
        u0 = u1;
        u1 = swap;
      }
      return new float[][] {{u0, v0}, {u1, v0}, {u1, v1}, {u0, v1}};
    }

    private static float[][] ordered(float[][] rect, boolean bottom) {
      return bottom
          ? new float[][] {rect[0], rect[1], rect[3], rect[2]}
          : new float[][] {rect[3], rect[2], rect[0], rect[1]};
    }

    private static void applyPose(float[] point, Pose pose) {
      double x = point[0];
      double y = point[1];
      double z = point[2];

      double cos = Math.cos(pose.zRot());
      double sin = Math.sin(pose.zRot());
      double x1 = x * cos - y * sin;
      double y1 = x * sin + y * cos;
      x = x1;
      y = y1;

      cos = Math.cos(pose.yRot());
      sin = Math.sin(pose.yRot());
      x1 = x * cos + z * sin;
      double z1 = -x * sin + z * cos;
      x = x1;
      z = z1;

      cos = Math.cos(pose.xRot());
      sin = Math.sin(pose.xRot());
      y1 = y * cos - z * sin;
      z1 = y * sin + z * cos;

      point[0] = (float) (x + pose.x());
      point[1] = (float) (y1 + pose.y());
      point[2] = (float) (z1 + pose.z());
    }

    float[] positions() {
      float[] result = new float[positions.size()];
      for (int i = 0; i < result.length; i++) result[i] = positions.get(i);
      return result;
    }

    float[] uvs() {
      float[] result = new float[uvs.size()];
      for (int i = 0; i < result.length; i++) result[i] = uvs.get(i);
      return result;
    }
  }
}
