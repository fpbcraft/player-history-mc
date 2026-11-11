package dev.fpbcraft.motd;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.Test;

class MotdRendererTest {
  @Test
  void rendersConditionallyAndReplacesActivityVariables() {
    var empty = new ActivityTracker.Snapshot(0, 2, 3, 90_000, 2, 10_000, "Alex", 3_600_000);
    String result = MotdRenderer.render("§aServer",
        List.of("[online] online", "[empty] §e{last_player} left {last_online} ago",
            "{players_today} visitors"),
        0, empty, 3_610_000, 200, "");
    assertEquals("§aServer\n§eAlex left 1h 0m ago", result);
    var active = new ActivityTracker.Snapshot(2, 2, 3, 90_000, 2, 0, "Alex", 3_600_000);
    assertEquals("Server\nonline",
        MotdRenderer.render("Server", List.of("[empty] empty", "[online] online"),
            0, active, 3_610_000, 200, ""));
    assertTrue(MotdRenderer.render("Server", List.of("Count: {online} / {players_today}"),
        0, active, 0, 1, "").endsWith("Count: 2 / 2"));
  }

  @Test
  void formatsDurationAndHandlesNoHistory() {
    assertEquals("0s", MotdRenderer.duration(0));
    assertEquals("1m", MotdRenderer.duration(60_000));
    assertEquals("2d 3h", MotdRenderer.duration(183_600_000));
    var firstStart = new ActivityTracker.Snapshot(0, 0, 0, 0, 0, 0, "", 0);
    assertEquals("Server\nnever",
        MotdRenderer.render("Server", List.of("{last_online}"),
            0, firstStart, 10_000, 1, ""));
  }
}
