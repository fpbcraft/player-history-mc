package dev.playerhistory.state;

import java.lang.reflect.Method;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.item.ItemStack;

/**
 * Optional reflective bridge to Curios 9.x.
 *
 * <p>The recorder has no hard Curios dependency. When Curios is present, this reads the same
 * visible stack choice used by Curios' client render state: a cosmetic stack wins; otherwise
 * the equipped stack is included only when that slot's render toggle is enabled.
 */
final class CuriosEquipmentReader {
  private volatile boolean initialized;
  private volatile Adapter adapter;

  Map<String, ItemStack> visible(LivingEntity entity) {
    Adapter current = adapter();
    return current == null ? Map.of() : current.visible(entity);
  }

  private Adapter adapter() {
    if (initialized) return adapter;
    synchronized (this) {
      if (initialized) return adapter;
      initialized = true;
      try {
        adapter = Adapter.create();
      } catch (ReflectiveOperationException | LinkageError ignored) {
        adapter = null;
      }
      return adapter;
    }
  }

  private record Adapter(
      Method getInventory,
      Method getCurios,
      Method getStacks,
      Method getCosmeticStacks,
      Method getRenders,
      Method getSlots,
      Method getStackInSlot) {

    static Adapter create() throws ReflectiveOperationException {
      Class<?> api = Class.forName("top.theillusivec4.curios.api.CuriosApi");
      Class<?> handler =
          Class.forName("top.theillusivec4.curios.api.type.capability.ICuriosItemHandler");
      Class<?> stacks =
          Class.forName("top.theillusivec4.curios.api.type.inventory.ICurioStacksHandler");
      Class<?> dynamic =
          Class.forName("top.theillusivec4.curios.api.type.inventory.IDynamicStackHandler");
      return new Adapter(
          api.getMethod("getCuriosInventory", LivingEntity.class),
          handler.getMethod("getCurios"),
          stacks.getMethod("getStacks"),
          stacks.getMethod("getCosmeticStacks"),
          stacks.getMethod("getRenders"),
          stacks.getMethod("getSlots"),
          dynamic.getMethod("getStackInSlot", int.class));
    }

    Map<String, ItemStack> visible(LivingEntity entity) {
      try {
        Object optional = getInventory.invoke(null, entity);
        if (!(optional instanceof Optional<?> inventory) || inventory.isEmpty()) return Map.of();
        Object handler = inventory.get();
        Object curiosValue = getCurios.invoke(handler);
        if (!(curiosValue instanceof Map<?, ?> curios) || curios.isEmpty()) return Map.of();

        var result = new LinkedHashMap<String, ItemStack>();
        for (var entry : curios.entrySet()) {
          String identifier = String.valueOf(entry.getKey());
          Object stacksHandler = entry.getValue();
          if (stacksHandler == null || identifier.isBlank()) continue;
          Object equipped = getStacks.invoke(stacksHandler);
          Object cosmetic = getCosmeticStacks.invoke(stacksHandler);
          Object rendersValue = getRenders.invoke(stacksHandler);
          List<?> renders =
              rendersValue instanceof List<?> list ? list : Collections.emptyList();
          int slots = ((Number) getSlots.invoke(stacksHandler)).intValue();
          for (int index = 0; index < slots; index++) {
            ItemStack cosmeticStack = stack(cosmetic, index);
            boolean renderable =
                index < renders.size()
                    && renders.get(index) instanceof Boolean value
                    && value;
            ItemStack visible =
                !cosmeticStack.isEmpty()
                    ? cosmeticStack
                    : renderable ? stack(equipped, index) : ItemStack.EMPTY;
            if (!visible.isEmpty()) result.put(key(identifier, index), visible);
          }
        }
        return result;
      } catch (ReflectiveOperationException | RuntimeException | LinkageError ignored) {
        return Map.of();
      }
    }

    private ItemStack stack(Object handler, int index) throws ReflectiveOperationException {
      Object value = getStackInSlot.invoke(handler, index);
      return value instanceof ItemStack stack ? stack : ItemStack.EMPTY;
    }
  }

  static String key(String identifier, int index) {
    return "curio:" + identifier + ":" + index;
  }
}
