(async () => {
  const base = new URL("player-history/", location.href);
  const { ReplayEngine, ChunkCache, heatmapPlan, mergePoints, BREAK, CONTEXT } =
    await import(new URL("replay-core.js?v=0.8.12", base));
  const { ReplayClock, clamp, addActivityBins, visibleEvents, clusterTimelineEvents } = await import(
    new URL("replay-state.js?v=0.8.12", base)
  );
  const { BlueMapAdapter, playerColor, eventColor } = await import(
    new URL("bluemap-adapter.js?v=0.8.12", base)
  );
  const { TelemetryCache, describeState, chatMessage } = await import(
    new URL("telemetry.js?v=0.8.12", base)
  );
  if (customElements.get("bluemap-player-replay")) return;
  const date = (time, seconds = true) =>
    new Date(time).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      ...(seconds ? { second: "2-digit" } : {}),
    });
  const trailOptions = [
    [0, "Off"],
    [30000, "30 seconds"],
    [60000, "1 minute"],
    [300000, "5 minutes"],
    [900000, "15 minutes"],
    [3600000, "1 hour"],
    [21600000, "6 hours"],
    [Infinity, "Full range"],
  ];
  class ReplayPanel extends HTMLElement {
    connectedCallback() {
      this.innerHTML = `<button name="open" aria-expanded="false" aria-controls="history-transport">◷ History</button>
        <section id="history-transport" hidden aria-label="Player history">
          <div class="history-heading"><span>◷ History</span>
            <label class="history-range">Range <select name="range" aria-label="History range"><option value="0.041666666666666664">Last hour</option><option value="0.125" selected>Last 3 hours</option><option value="0.25">Last 6 hours</option><option value="1">Last 24 hours</option><option value="2">Last 48 hours</option><option value="7">Last week</option><option value="30">Last 30 days</option><option value="all">All history</option><option value="custom">Last N days…</option><option value="dates">Custom dates…</option></select></label>
            <form class="history-custom-days" hidden><label>Last <input name="days" aria-label="Number of days" type="number" min="1" max="36500" step="1" value="14" required> days</label><button type="submit">Apply</button></form>
            <output name="current">—</output><button name="compact" aria-label="Expand controls" aria-expanded="false">⌃</button><button name="close" aria-label="Close history">×</button></div>
          <form class="history-custom-dates" hidden><label>From <input name="date-from" type="datetime-local" step="1" required></label><label>To <input name="date-to" type="datetime-local" step="1" required></label><button type="submit">Apply dates</button></form>
          <div class="history-dates"><span name="start">—</span><span name="end">—</span></div>
          <div class="history-timeline"><div class="history-histogram" aria-label="Recording density across the selected range"></div><input name="timeline" type="range" min="0" max="1" step="1" value="1" aria-label="Replay timeline">
            <output class="history-tooltip" hidden></output>
            <div class="history-events" aria-label="Events in loaded replay window"></div></div>
          <div class="history-density-status" hidden role="status">Recording density · all players · 1-minute resolution</div>
          <div class="history-controls">
            <button name="back" title="Back five minutes" aria-label="Back five minutes">↶</button>
            <div class="history-shuttle-wrap"><div name="shuttle" class="history-shuttle" role="slider" tabindex="0" aria-label="Hold to rewind or fast forward; release to restore playback" aria-valuemin="-120" aria-valuemax="120" aria-valuenow="1"><span>−120×</span><div class="history-shuttle-track"><i></i></div><span>120×</span></div><output name="rate">Shuttle · 1×</output></div>
            <button name="forward" title="Forward five minutes" aria-label="Forward five minutes">↷</button>
            <button name="play" aria-label="Play replay">▶</button>
            <button name="latest" title="Follow live events and BlueMap player positions" aria-label="Follow live">NOW</button>
            <div class="history-speed"><button name="speed-button" type="button" aria-label="Playback speed" title="Playback speed" aria-expanded="false">⏱</button><div class="history-speed-popover history-popover history-choices" hidden>${[0.25, 0.5, 1, 2, 4, 8, 16, 32, 64].map(rate => `<button type="button" data-speed="${rate}" aria-pressed="${rate === 1}">${rate}×</button>`).join("")}<input name="speed" type="hidden" value="1"></div></div>
            <div class="history-secondary"><div class="history-trails"><button name="trails-button" aria-label="Trail duration" title="Trails" aria-expanded="false">⌁</button><div class="history-trails-popover history-popover history-choices" hidden>${trailOptions.map(([value,label]) => `<button type="button" data-trail="${value}" aria-pressed="${value === 60000}">${label}</button>`).join("")}<input name="trails" type="hidden" value="60000"></div></div>
              <div class="history-player-control"><button name="players" aria-expanded="false" aria-controls="history-players" aria-label="Filter players" title="Players">♙</button>
                <div id="history-players" class="history-popover" hidden><div class="history-popover-heading">Players<button name="all">Select all</button></div><div class="history-player-list"></div></div></div>
              <details class="history-event-control"><summary aria-label="Event filters" title="Event filters">⚙</summary><div class="history-event-options history-popover"><div class="history-event-filter-list"></div><small>Unchecked types are hidden from this viewer.</small></div></details><button name="heat" aria-pressed="false" title="Time spent in the replay range; completed recording chunks" aria-label="Heatmap">▦</button><button name="webchat" aria-label="Web chat" title="Web chat">☏</button></div>
          </div>
          <div class="history-webchat" hidden><div class="history-webchat-feed" aria-live="polite"></div><button name="chat-connect">Connect Minecraft account</button><button name="chat-logout" hidden>Log out</button><output name="chat-status"></output><form class="history-chat-form" hidden><input name="chat-message" aria-label="Chat message" maxlength="256" placeholder="Message the server…" required><button type="submit">Send</button></form></div><div class="history-chat" aria-live="polite" aria-label="Chat history for selected range"></div><div class="history-status" role="status">Live · local time</div>
        </section>
        <aside class="history-chat-panel" hidden aria-label="Web chat"><div class="history-chat-heading"><strong>Chat</strong><button name="chat-close" aria-label="Close chat">×</button></div><div class="history-chat-content"></div></aside>`;
      this.q = (name) => this.querySelector(`[name="${name}"]`);
      const icons = {
        players: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
        webchat: "M21 11a8 8 0 0 1-8 8H7l-5 3V11a9 9 0 0 1 19 0Z",
        "trails-button": "M5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4M19 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4M7 17c4 0 3-10 8-10h2",
        "speed-button": "M3 18a10 10 0 1 1 18 0M12 14l5-6M5 18h14",
        heat: "M4 4h5v5H4zM10 4h5v5h-5zM16 4h4v5h-4zM4 10h5v5H4zM10 10h5v5h-5zM16 10h4v5h-4zM4 16h5v4H4zM10 16h5v4h-5zM16 16h4v4h-4z",
      };
      const iconMarkup = (path) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
      for (const [name, path] of Object.entries(icons)) this.q(name).innerHTML = iconMarkup(path);
      const eventControl = this.querySelector(".history-event-control");
      eventControl.querySelector("summary").innerHTML = iconMarkup("M12 3v2m0 14v2M3 12h2m14 0h2M5.64 5.64l1.42 1.42m9.88 9.88 1.42 1.42m0-12.72-1.42 1.42M7.06 16.94l-1.42 1.42M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0");
      const heading = this.querySelector(".history-heading");
      const headerTools = document.createElement("div");
      headerTools.className = "history-header-tools";
      for (const selector of [".history-trails", ".history-player-control", '[name="heat"]'])
        headerTools.append(this.querySelector(selector));
      headerTools.append(eventControl);
      heading.insertBefore(headerTools, this.q("compact"));
      const secondary = this.querySelector(".history-secondary");
      const chatLauncher = this.q("webchat");
      chatLauncher.classList.add("history-chat-launcher");
      chatLauncher.setAttribute("aria-controls", "history-chat-panel");
      chatLauncher.setAttribute("aria-expanded", "false");
      this.append(chatLauncher);
      const chatPanel = this.querySelector(".history-chat-panel");
      chatPanel.id = "history-chat-panel";
      const chatContent = this.querySelector(".history-chat-content");
      const webchat = this.querySelector(".history-webchat");
      webchat.hidden = false;
      chatContent.append(this.querySelector(".history-chat"), webchat);
      secondary.remove();
      const eventMenu = this.querySelector(".history-event-options");
      eventMenu.setAttribute("popover", "manual");
      eventControl.ontoggle = () => this.showMenu(eventMenu, eventControl.querySelector("summary"), eventControl.open);
      this.querySelector("#history-players").setAttribute("popover", "manual");
      this.clock = new ReplayClock();
      const savedRange = localStorage.getItem("player-history-range");
      if (savedRange !== "dates" && [...this.q("range").options].some((option) => option.value === savedRange))
        this.q("range").value = savedRange;
      const savedDays = Number(localStorage.getItem("player-history-custom-days"));
      if (Number.isInteger(savedDays) && savedDays > 0 && savedDays <= 36500)
        this.q("days").value = String(savedDays);
      const initialRange = this.q("range").value;
      this.clock.rangeDuration = initialRange === "all"
        ? Infinity
        : Number(initialRange === "custom" ? this.q("days").value : initialRange) * 86400000;
      const savedSpeed = Number(localStorage.getItem("player-history-speed"));
      if ([0.25, 0.5, 1, 2, 4, 8, 16, 32, 64].includes(savedSpeed))
        this.clock.playbackRate = savedSpeed;
      this.isLive = true;
      this.liveEvents = [];
      this.livePoints = [];
      this.mobileQuery = matchMedia("(max-width: 600px)");
      this.compact = this.mobileQuery.matches;
      this.classList.toggle("compact", this.compact);
      this.q("compact").onclick = () => {
        this.closeChoices();
        this.compact = !this.compact;
        this.classList.toggle("compact", this.compact);
        this.q("compact").setAttribute("aria-expanded", String(!this.compact));
        this.q("compact").setAttribute(
          "aria-label",
          this.compact ? "Expand controls" : "Collapse controls",
        );
        this.q("compact").textContent = this.compact ? "⌃" : "⌄";
        this.sync();
      };
      this.mobileQuery.addEventListener?.("change", (event) => {
        this.compact = event.matches;
        this.classList.toggle("compact", this.compact);
        this.q("compact").setAttribute("aria-expanded", String(!this.compact));
        this.q("compact").setAttribute(
          "aria-label",
          this.compact ? "Expand controls" : "Collapse controls",
        );
        this.q("compact").textContent = this.compact ? "⌃" : "⌄";
        this.sync();
      });
      this.engine = new ReplayEngine();
      this.names = new Map();
      this.selection = new Set();
      try {
        const selected = JSON.parse(localStorage.getItem("player-history-players") || "null");
        if (Array.isArray(selected)) {
          this.selection = new Set(selected.filter(Number.isFinite));
          this.hasSavedSelection = true;
        }
      } catch {}
      this.events = [];
      this.overlayEvents = [];
      this.disabledEvents = new Set([
        "ITEM_PICKUP",
        "ITEM_DROP",
        "BLOCK_PLACE",
        "BLOCK_BREAK",
        "CONTAINER_OPEN",
        "TELEPORT",
      ]);
      try {
        const saved = JSON.parse(
          localStorage.getItem("player-history-hidden-events") || "null",
        );
        if (Array.isArray(saved))
          this.disabledEvents = new Set(
            saved.filter((type) => typeof type === "string"),
          );
      } catch {}
      this.eventTypes = new Set([
        "CHAT",
        "JOIN",
        "QUIT",
        "RESPAWN",
        "DEATH",
        "TELEPORT",
        "DIMENSION_CHANGE",
        "BLOCK_BREAK",
        "BLOCK_PLACE",
        "CONTAINER_OPEN",
        "DAMAGE_TAKEN",
        "DAMAGE_DEALT",
        "MOB_KILL",
        "PLAYER_KILL",
        "ADVANCEMENT",
        "CRAFT",
        "SMELT",
        "ENCHANT",
        "TRADE",
        "ITEM_PICKUP",
        "ITEM_DROP",
      ]);
      this.renderEventFilters();
      const savedTrail = localStorage.getItem("player-history-trails");
      this.trailMode = savedTrail === "Infinity" ? Infinity : Number(savedTrail ?? 60000);
      if (!trailOptions.some(([value]) => Object.is(value, this.trailMode))) this.trailMode = 60000;
      this.heatEnabled = localStorage.getItem("player-history-heatmap") === "true";
      this.chatPinned = true;
      this.rangeEvents = [];
      this.requestId = 0;
      this.status = this.querySelector(".history-status");
      this.chatToken = localStorage.getItem("player-history-chat-token") || "";
      this.q("webchat").onclick = () => {
        const box = this.querySelector(".history-chat-panel");
        box.hidden = false;
        this.q("webchat").hidden = true;
        this.q("webchat").setAttribute("aria-expanded", "true");
        if (this.mobileQuery.matches) {
          if (this.opened) this.close();
          this.q("open").hidden = true;
        }
        clearInterval(this.chatTimer);
        this.pollChat();
        this.chatTimer = setInterval(() => this.pollChat(), 2000);
      };
      this.q("chat-close").onclick = () => this.closeChat();
      this.q("chat-connect").onclick = async () => {
        try {
          const pair = await this.chatRequest("pair");
          this.chatToken = pair.token;
          localStorage.setItem("player-history-chat-token", pair.token);
          this.q("chat-status").textContent = `Run /webchat link ${pair.code} in Minecraft (expires in 5 minutes).`;
        } catch (error) { this.q("chat-status").textContent = error.message; }
      };
      this.q("chat-logout").onclick = async () => {
        try {
          await this.chatRequest("logout");
          this.chatToken = ""; localStorage.removeItem("player-history-chat-token");
          this.q("chat-status").textContent = "Logged out";
          this.pollChat();
        } catch (error) { this.q("chat-status").textContent = error.message; }
      };
      this.querySelector(".history-chat-form").onsubmit = async event => {
        event.preventDefault();
        const input = this.q("chat-message"), button = event.currentTarget.querySelector("button");
        button.disabled = true;
        try { await this.chatRequest("send", { message: input.value }); input.value = ""; await this.pollChat(); }
        catch (error) { this.q("chat-status").textContent = error.message; }
        finally { button.disabled = false; }
      };
      this.q("open").onclick = () => this.open();
      this.q("close").onclick = () => this.close();
      this.q("speed").onchange = () => {
        this.clock.playbackRate = Number(this.q("speed").value);
        localStorage.setItem("player-history-speed", String(this.clock.playbackRate));
        this.q("speed-button").title = `Playback speed: ${this.clock.playbackRate}×`;
        this.querySelector(".history-speed-popover").hidden = true;
        this.sync();
      };
      for (const [kind, selector] of [["speed", "data-speed"], ["trails", "data-trail"]]) {
        const menu = this.querySelector(`.history-${kind}-popover`);
        const trigger = this.q(`${kind}-button`);
        menu.setAttribute("popover", "manual");
        trigger.onclick = () => {
          const open = menu.hidden;
          this.closeChoices();
          if (open) {
            menu.hidden = false;
            menu.showPopover?.();
            const bounds = trigger.getBoundingClientRect();
            menu.style.left = `${Math.max(8, Math.min(bounds.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8))}px`;
            menu.style.top = `${Math.max(8, bounds.top - menu.offsetHeight - 8)}px`;
          }
          trigger.setAttribute("aria-expanded", String(open));
        };
        menu.querySelectorAll(`[${selector}]`).forEach(button => {
          button.onclick = () => {
            this.q(kind).value = button.getAttribute(selector);
            this.q(kind).onchange();
            menu.querySelectorAll("button").forEach(option => option.setAttribute("aria-pressed", String(option === button)));
            this.closeChoices();
          };
        });
      }
      this.q("range").onchange = () => {
        const custom = this.q("range").value === "custom";
        const dates = this.q("range").value === "dates";
        this.querySelector(".history-custom-dates").hidden = !dates;
        if (dates) {
          const local = (t) =>
            new Date(t - new Date(t).getTimezoneOffset() * 60000)
              .toISOString()
              .slice(0, 19);
          if (this.manifest) {
            this.q("date-from").value = local(this.clock.from);
            this.q("date-to").value = local(this.clock.to);
          }
          this.q("date-from").focus();
        }
        this.querySelector(".history-custom-days").hidden = !custom;
        if (custom) this.q("days").focus();
        else if (!dates) this.changeRange();
      };
      this.querySelector(".history-custom-days").onsubmit = (event) => {
        event.preventDefault();
        this.changeRange();
      };
      this.querySelector(".history-custom-dates").onsubmit = (event) => {
        event.preventDefault();
        this.changeRange();
      };
      this.q("back").onclick = () => this.seek(this.clock.time - 300000);
      this.q("forward").onclick = () => this.seek(this.clock.time + 300000);
      this.q("latest").onclick = () => {
        this.goNow();
      };
      this.q("play").onclick = () => {
        this.isLive = false;
        this.clock.togglePlayback();
        this.seek(this.clock.time);
        this.sync();
      };
      const timeline = this.q("timeline");
      timeline.oninput = () => {
        const value = Number(timeline.value);
        if (value >= Number(timeline.max) - 1) this.goNow();
        else this.seek(this.clock.from + value);
      };
      timeline.onpointerdown = () => {
        this.scrubbing = true;
        this.sync();
      };
      const finishScrub = () => {
        this.scrubbing = false;
        this.sync();
      };
      this.addEventListener("pointerup", finishScrub);
      this.addEventListener("pointercancel", finishScrub);
      timeline.onblur = finishScrub;
      timeline.onkeydown = (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        event.stopPropagation();
        const step = event.shiftKey ? 300000 : 10000;
        this.seek(
          event.key === "Home"
            ? this.clock.from
            : event.key === "End"
              ? this.clock.to
              : this.clock.time + (event.key === "ArrowLeft" ? -step : step),
        );
      };
      timeline.addEventListener(
        "wheel",
        (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.seek(
            this.clock.time +
              Math.sign(event.deltaY) * (event.shiftKey ? 300000 : 10000),
          );
        },
        { passive: false },
      );
      const shuttle = this.q("shuttle");
      const move = (event) => {
        const bounds = shuttle
          .querySelector(".history-shuttle-track")
          .getBoundingClientRect();
        const position = clamp(
          ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
          -1,
          1,
        );
        this.clock.shuttle(position);
        shuttle.style.setProperty("--shuttle", `${(position + 1) * 50}%`);
        this.sync();
      };
      shuttle.onpointerdown = (event) => {
        if (!Number.isFinite(this.clock.time)) return;
        if (event.button !== 0 || this.shuttlePointer !== undefined) return;
        event.preventDefault();
        shuttle.focus();
        shuttle.setPointerCapture(event.pointerId);
        this.shuttlePointer = event.pointerId;
        shuttle.classList.add("held");
        move(event);
      };
      shuttle.onpointermove = (event) => {
        if (event.pointerId === this.shuttlePointer) move(event);
      };
      const release = () => {
        this.shuttlePointer = undefined;
        this.clock.release();
        shuttle.classList.remove("held");
        shuttle.style.setProperty("--shuttle", "50%");
        this.sync();
      };
      shuttle.onpointerup =
        shuttle.onpointercancel =
        shuttle.onlostpointercapture =
          release;
      shuttle.onblur = release;
      shuttle.onkeydown = (event) => {
        if (!Number.isFinite(this.clock.time)) return;
        if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        this.clock.shuttle(event.key === "ArrowLeft" ? -0.5 : 0.5);
        shuttle.style.setProperty(
          "--shuttle",
          event.key === "ArrowLeft" ? "25%" : "75%",
        );
        this.sync();
      };
      shuttle.onkeyup = release;
      this.releaseShuttle = release;
      this.q("players").onclick = () => this.togglePlayers();
      this.q("all").onclick = () => {
        this.selection = new Set(this.names.keys());
        localStorage.setItem("player-history-players", JSON.stringify([...this.selection]));
        this.hasSavedSelection = true;
        this.renderPlayers();
        this.updateOverlays();
      };
      this.q("trails").onchange = () => {
        this.trailMode = Number(this.q("trails").value);
        localStorage.setItem("player-history-trails", String(this.trailMode));
        this.trailDataKey = null;
        this.trailAbort?.abort();
        this.fullTrails = null;
        this.sync();
        this.updateOverlays();
      };
      this.q("heat").onclick = () => {
        this.heatEnabled = !this.heatEnabled;
        localStorage.setItem("player-history-heatmap", String(this.heatEnabled));
        this.heatAbort?.abort();
        this.sync();
        this.updateOverlays();
        if (this.heatEnabled) this.loadHeat();
      };
      this.listeners = new AbortController();
      document.addEventListener(
        "pointerdown",
        (event) => {
          if (!eventControl.contains(event.target)) eventControl.open = false;
          if (
            !this.querySelector(".history-player-control").contains(
              event.target,
            )
          )
            this.togglePlayers(false);
          for (const kind of ["speed", "trails"]) {
            if (!this.querySelector(`.history-${kind}`).contains(event.target)) {
              const menu = this.querySelector(`.history-${kind}-popover`);
              menu.hidePopover?.();
              menu.hidden = true;
              this.q(`${kind}-button`).setAttribute("aria-expanded", "false");
            }
          }
        },
        { signal: this.listeners.signal },
      );
      this.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          this.closeChoices();
          this.togglePlayers(false);
          this.releaseShuttle();
          this.q("players").focus();
        }
      });
      window.addEventListener(
        "blur",
        () => {
          finishScrub();
          release();
        },
        { signal: this.listeners.signal },
      );
      this.lastFrame = performance.now();
      this.q("speed").value = String(this.clock.playbackRate);
      this.q("trails").value = String(this.trailMode);
      this.querySelector(".history-chat").addEventListener("scroll", (event) => {
        const chat = event.currentTarget;
        this.chatPinned = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 20;
      });
      this.sync();
      this.frame = requestAnimationFrame((time) => this.animate(time));
      this.refresh(true).then(() => this.pollLive());
      this.liveTimer = setInterval(() => this.pollLive(), 1000);
      this.refreshTimer = setInterval(() => this.refresh(), 45000);
    }
    closeChoices() {
      this.querySelector(".history-event-control").open = false;
      for (const kind of ["speed", "trails"]) {
        const menu = this.querySelector(`.history-${kind}-popover`);
        menu.hidePopover?.(); menu.hidden = true;
        this.q(`${kind}-button`).setAttribute("aria-expanded", "false");
      }
    }
    async chatRequest(action, body = {}) {
      const response = await fetch(`/player-history-api/${action}`, {
        method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${this.chatToken}` },
        body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
      });
      if (!response.headers.get("content-type")?.includes("application/json")) throw Error("Web chat is unavailable. The server needs its chat API proxy configured.");
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "Web chat unavailable");
      return result;
    }
    async pollChat() {
      if (this.chatLoading) return;
      this.chatLoading = true;
      try {
        const session = await this.chatRequest("session");
        this.q("chat-connect").hidden = session.linked;
        this.q("chat-logout").hidden = !session.linked;
        this.querySelector(".history-chat-form").hidden = !session.linked;
        if (session.linked) this.q("chat-status").textContent = `Connected as ${session.name}`;
        const response = await fetch("/player-history-api/messages", { cache: "no-store", signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw Error("Chat feed unavailable");
        const data = await response.json();
        const feed = this.querySelector(".history-webchat-feed");
        const key = JSON.stringify(data.messages);
        if (key !== this.chatFeedKey) {
          this.chatFeedKey = key; feed.replaceChildren();
          for (const message of data.messages || []) {
            const row = document.createElement("div");
            row.textContent = `${message.web ? "[Web] " : ""}${message.name}: ${message.message}`;
            feed.append(row);
          }
          feed.scrollTop = feed.scrollHeight;
        }
      } catch (error) { this.q("chat-status").textContent = error.message; }
      finally { this.chatLoading = false; }
    }
    async open() {
      if (this.mobileQuery.matches) this.closeChat();
      this.opened = true;
      if (this.mobileQuery.matches) this.q("webchat").hidden = true;
      this.q("open").hidden = true;
      this.q("open").setAttribute("aria-expanded", "true");
      this.querySelector("section").hidden = false;
      this.q("close").focus();
      this.trailMode = this.trailMode || 60000;
      this.q("trails").value = String(this.trailMode);
      localStorage.setItem("player-history-trails", String(this.trailMode));
      this.goNow();
      await this.refresh(true);
    }
    close() {
      this.closeChoices();
      this.opened = false;
      clearInterval(this.chatTimer);
      this.clock.isPlaying = false;
      this.releaseShuttle();
      this.togglePlayers(false);
      this.heatAbort?.abort();
      this.activityAbort?.abort();
      this.querySelector("section").hidden = true;
      this.q("open").hidden = false;
      if (this.mobileQuery.matches && this.querySelector(".history-chat-panel").hidden)
        this.q("webchat").hidden = false;
      this.q("open").setAttribute("aria-expanded", "false");
      this.q("open").focus();
    }
    closeChat() {
      clearInterval(this.chatTimer);
      this.querySelector(".history-chat-panel").hidden = true;
      this.q("webchat").hidden = false;
      this.q("webchat").setAttribute("aria-expanded", "false");
      if (this.mobileQuery.matches && !this.opened) this.q("open").hidden = false;
    }
    goNow() {
      this.isLive = true;
      this.clock.isPlaying = false;
      if (this.clock.customRange) {
        this.clock.customRange = null;
        this.q("range").value = localStorage.getItem("player-history-range") || "0.125";
        this.querySelector(".history-custom-dates").hidden = true;
      }
      if (this.manifest) {
        this.clock.refresh(
          this.manifest.earliestTimestamp,
          Math.max(this.manifest.latestTimestamp, Date.now()),
          true,
        );
        this.clock.seek(this.clock.to);
      }
      this.sync();
      this.render();
      this.updateOverlays();
      this.pollLive();
    }
    togglePlayers(open = this.querySelector("#history-players").hidden) {
      this.showMenu(this.querySelector("#history-players"), this.q("players"), open);
      this.q("players").setAttribute("aria-expanded", String(open));
    }
    showMenu(menu, trigger, open) {
      if (!open) { menu.hidePopover?.(); menu.hidden = true; return; }
      menu.hidden = false; menu.showPopover?.();
      const bounds = trigger.getBoundingClientRect();
      menu.style.left = `${Math.max(8, Math.min(bounds.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(bounds.top - menu.offsetHeight - 8, innerHeight - menu.offsetHeight - 8))}px`;
    }
    renderPlayers() {
      const list = this.querySelector(".history-player-list");
      list.replaceChildren();
      for (const [id, name] of this.names) {
        const label = document.createElement("label"),
          input = document.createElement("input");
        input.type = "checkbox";
        input.checked = this.selection.has(id);
        input.onchange = () => {
          input.checked ? this.selection.add(id) : this.selection.delete(id);
          localStorage.setItem("player-history-players", JSON.stringify([...this.selection]));
          this.hasSavedSelection = true;
          this.sync();
          this.updateOverlays();
        };
        const swatch = document.createElement("i");
        swatch.className = "history-player-color";
        swatch.style.background = playerColor(id);
        label.append(input, swatch, document.createTextNode(name));
        list.append(label);
      }
      this.sync();
    }
    async refresh(reset = false) {
      if (this.refreshing) return;
      this.refreshing = true;
      this.manifestAbort = new AbortController();
      try {
        const res = await fetch(new URL("data/manifest.json", base), {
          cache: "no-store",
          signal: this.manifestAbort.signal,
        });
        if (!res.ok)
          throw Error(
            "No published history yet. Waiting for the first recording.",
          );
        const m = await res.json();
        if (m.protocolVersion !== 2) throw Error("Unsupported history version");
        if (
          !Number.isFinite(m.earliestTimestamp) ||
          !Number.isFinite(m.latestTimestamp) ||
          m.latestTimestamp < m.earliestTimestamp ||
          m.latestTimestamp <= 0 ||
          !(m.chunkDurationMs > 0)
        )
          throw Error("No recorded history yet.");
        const previous = this.manifest;
        const changed =
          reset ||
          !previous ||
          previous.latestTimestamp !== m.latestTimestamp ||
          previous.earliestTimestamp !== m.earliestTimestamp;
        this.manifest = m;
        this.telemetryCache?.chunks.clear();
        for (const [control, cap] of [
          ["trails", "movement"],
          ["heatmap", "heatmap"],
        ]) {
          const element = this.q(control);
          if (element) {
            element.disabled = m.capabilities?.[cap] === false;
            element.title = element.disabled
              ? "This dataset has no recorded " + cap
              : "";
          }
        }
        if (!this.integration) {
          const config = await fetch(new URL("integration.json", base), {
            cache: "no-store",
          });
          if (!config.ok) throw Error("Missing BlueMap integration mapping");
          this.integration = await config.json();
        }
        if (!this.cache || this.cache.duration !== m.chunkDurationMs) {
          this.cache?.clear();
          this.cache = new ChunkCache(
            new URL("data", base).href,
            m.chunkDurationMs,
          );
        }
        for (const player of m.registry.players) {
          if (!this.hasSavedSelection && !this.names.has(player.id)) this.selection.add(player.id);
        }
        this.names = new Map(
          m.registry.players.map((player) => [player.id, player.name]),
        );
        this.selection = new Set(
          [...this.selection].filter((id) => this.names.has(id)),
        );
        this.clock.refresh(m.earliestTimestamp, Math.max(m.latestTimestamp, Date.now()), reset);
        this.renderPlayers();
        if (changed) await this.reloadRange();
        else this.loadActivity();
        this.render();
        this.updateOverlays();
      } catch (error) {
        this.report(error);
      } finally {
        this.refreshing = false;
      }
    }
    report(error) {
      if (error.name !== "AbortError") this.status.textContent = error.message;
    }
    async changeRange() {
      const choice = this.q("range").value;
      if (choice === "custom" && !this.q("days").reportValidity()) return;
      if (choice === "dates") {
        this.isLive = false;
        const from = new Date(this.q("date-from").value).getTime(),
          to = new Date(this.q("date-to").value).getTime();
        if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
          this.status.textContent = "Choose an end date after the start date.";
          return;
        }
        this.clock.customRange = { from, to };
      } else this.clock.customRange = null;
      if (choice !== "dates")
        this.clock.rangeDuration =
          choice === "all"
            ? Infinity
            : Number(choice === "custom" ? this.q("days").value : choice) *
              86400000;
      localStorage.setItem("player-history-range", choice);
      if (choice === "custom")
        localStorage.setItem("player-history-custom-days", this.q("days").value);
      if (!this.manifest) return;
      this.clock.refresh(
        this.manifest.earliestTimestamp,
        Math.max(this.manifest.latestTimestamp, Date.now()),
      );
      this.sync();
      await this.reloadRange();
    }
    async loadActivity() {
      this.activityAbort?.abort();
      const controller = new AbortController();
      this.activityAbort = controller;
      const { from, to } = this.clock,
        chart = this.querySelector(".history-histogram");
      const caption = this.querySelector(".history-density-status");
      chart.replaceChildren();
      if (!this.manifest?.activityBucketMs) {
        caption.textContent = "Recording density is not available yet";
        return;
      }
      const count = Math.max(
        12,
        Math.min(96, Math.floor((chart.clientWidth || 720) / 10)),
      );
      const bins = Array(count).fill(0),
        day = 86400000;
      const first = Math.floor(from / day) * day,
        last = Math.floor(to / day) * day;
      if ((last - first) / day > 2000) {
        caption.textContent =
          "Choose a range of up to 2,000 days to show recording density";
        return;
      }
      caption.textContent = "Loading recording density…";
      try {
        for (let start = first; start <= last; start += day) {
          const res = await fetch(
            new URL("data/activity/" + start + ".json", base),
            { signal: controller.signal, cache: "no-store" },
          );
          if (res.status === 404) continue;
          if (!res.ok) throw Error("Recording density unavailable");
          const rows = await res.json();
          if (!Array.isArray(rows) || rows.length > 1440)
            throw Error("Invalid recording density");
          addActivityBins(bins, rows, from, to);
        }
        if (controller.signal.aborted || !this.opened) return;
        const max = Math.max(0, ...bins);
        for (let i = 0; i < bins.length; i++) {
          const bar = document.createElement("span");
          bar.style.height =
            bins[i] > 0 ? `max(2px, ${(bins[i] / max) * 100}%)` : "0";
          bar.title =
            date(from + ((to - from) * i) / count) +
            " · " +
            Math.round(bins[i]).toLocaleString() +
            " recorded samples (approx.)";
          chart.append(bar);
        }
        const total = Math.round(bins.reduce((a, b) => a + b, 0));
        caption.textContent =
          this.manifest.activityReady === false
            ? "Recording density · history is still being indexed"
            : max
              ? "Recording density · all players · minute-level counts"
              : "No recorded samples in this range";
        chart.setAttribute(
          "aria-label",
          "Recording density: approximately " +
            total.toLocaleString() +
            " samples across " +
            count +
            " intervals. Taller bars mean more recorded samples.",
        );
      } catch (error) {
        if (error.name !== "AbortError") caption.textContent = error.message;
      }
    }
    async reloadRange() {
      this.loadActivity();
      this.cache.clear();
      this.requestId++;
      this.pendingBucket = this.loadedBucket = undefined;
      this.fullTrails = null;
      this.trailDataKey = null;
      this.trailAbort?.abort();
      this.heatAbort?.abort();
      this.heatRows = null;
      this.heatKey = this.trailKey = null;
      this.updateOverlays();
      this.loadRangeEvents();
      await this.loadWindow();
      if (this.heatEnabled && this.opened) this.loadHeat();
    }
    sync() {
      const c = this.clock,
        valid = Number.isFinite(c.time);
      for (const name of [
        "timeline",
        "back",
        "forward",
        "play",
        "latest",
        "trails",
        "heat",
      ])
        this.q(name).disabled = !valid;
      if (valid) {
        this.q("timeline").max = Math.max(1, c.to - c.from);
        this.q("timeline").value = c.time - c.from;
        this.q("timeline").disabled = c.from === c.to;
        this.q("timeline").setAttribute("aria-valuetext", date(c.time));
        this.q("start").textContent = date(c.from, false);
        this.q("end").textContent = date(c.to, false);
        this.q("current").textContent = date(c.time);
        this.q("latest").disabled = this.isLive;
        this.q("latest").setAttribute("aria-pressed", String(this.isLive));
        const tooltip = this.querySelector(".history-tooltip");
        tooltip.hidden = !this.scrubbing;
        tooltip.textContent = date(c.time);
        tooltip.style.left = `${clamp(((c.time - c.from) / Math.max(1, c.to - c.from)) * 100, 14, 86)}%`;
      }
      // Keep the visual control identical at every breakpoint; the accessible
      // label carries the full action name.
      this.q("play").textContent = c.isPlaying ? "Ⅱ" : "▶";
      this.q("play").setAttribute(
        "aria-label",
        c.isPlaying ? "Pause replay" : "Play replay",
      );
      this.q("rate").textContent = c.isShuttling
        ? `Shuttle · ${Number(c.shuttleRate.toFixed(1))}×`
        : `Shuttle · release to ${c.playbackRate}×`;
      this.q("shuttle").setAttribute("aria-valuenow", c.shuttleRate.toFixed(1));
      this.q("players").title = `Players · ${this.selection.size} selected`;
      this.q("trails").value = String(this.trailMode);
      this.q("heat").setAttribute("aria-pressed", String(!!this.heatEnabled));
      this.querySelectorAll("[data-speed]").forEach((button) =>
        button.setAttribute("aria-pressed", String(Number(button.dataset.speed) === c.playbackRate)));
      this.querySelectorAll("[data-trail]").forEach((button) =>
        button.setAttribute("aria-pressed", String(Number(button.dataset.trail) === this.trailMode)));
    }
    async goToEvent(event) {
      if (!event?.point) return;
      this.seek(event.point.time);
      const worldKey = this.manifest?.registry?.worlds?.find(
        (world) => world.id === event.point.world,
      )?.key;
      const mapId = Object.entries(this.integration?.mapWorlds || {}).find(
        ([, key]) => key === worldKey,
      )?.[0];
      if (mapId && mapId !== this.adapter?.mapId && window.bluemap?.switchMap)
        await window.bluemap.switchMap(mapId, false);
      this.adapter?.focusPoint(event.point);
    }
    seek(time) {
      this.isLive = false;
      if (!this.manifest || !Number.isFinite(time)) return;
      this.clock.seek(time);
      this.sync();
      this.render();
      const bucket = Math.floor(this.clock.time / this.cache.duration);
      if (bucket !== this.loadedBucket && bucket !== this.pendingBucket) {
        // Throttle, rather than debounce: a held drag keeps updating the map.
        if (!this.seekTimer)
          this.seekTimer = setTimeout(() => {
            this.seekTimer = null;
            this.loadWindow();
          }, 80);
      }
    }
    async loadWindow() {
      if (!this.cache) return;
      const id = ++this.requestId,
        bucket = Math.floor(this.clock.time / this.cache.duration);
      this.pendingBucket = bucket;
      try {
        const data = await this.cache.window(this.clock.time);
        if (id !== this.requestId) return;
        if (bucket !== Math.floor(this.clock.time / this.cache.duration))
          return;
        this.engine.setPoints(data.points);
        this.events = data.events;
        this.loadedBucket = bucket;
        this.status.textContent = data.points.length
          ? this.isLive
            ? "Live · local time"
            : "Historical replay · local time"
          : "No recorded data in this window";
        this.render();
        this.updateOverlays();
      } catch (error) {
        if (id === this.requestId) this.report(error);
      } finally {
        if (id === this.requestId) {
          this.pendingBucket = undefined;
          if (
            bucket !== Math.floor(this.clock.time / this.cache.duration) &&
            this.loadedBucket !==
              Math.floor(this.clock.time / this.cache.duration)
          )
            this.loadWindow();
        }
      }
    }
    animate(time) {
      const delta = Number.isFinite(this.lastFrame)
        ? Math.max(0, Math.min(time - this.lastFrame, 1000))
        : 0;
      this.lastFrame = time;
      this.frame = requestAnimationFrame((t) => this.animate(t));
      if (this.manifest && this.cache) {
        if (!this.scrubbing && this.clock.rate) {
          this.clock.tick(delta);
          this.seek(this.clock.time);
        }
        this.render();
        if (!this.lastOverlay || time - this.lastOverlay > 500) {
          this.updateOverlays();
          this.adapter?.layoutEvents();
          this.lastOverlay = time;
        }
      }
    }
    world() {
      const key = this.integration?.mapWorlds?.[this.adapter.mapId];
      return this.manifest.registry.worlds.find((world) => world.key === key)
        ?.id;
    }
    render() {
      if (!this.manifest || !this.cache) return;
      try {
        if (!this.adapter) {
          this.adapter = new BlueMapAdapter(window.bluemap, window.BlueMap);
          this.telemetryCache = new TelemetryCache(
            base,
            this.manifest.chunkDurationMs,
          );
          this.adapter.stateDetails = async (player, time) =>
            describeState(
              await this.telemetryCache.at(player, time),
              this.manifest.registry,
              this.manifest.capabilities,
            );
          this.trailKey = this.eventKey = this.heatKey = null;
        }
        const world = this.world();
        const ready =
          Math.floor(this.clock.time / this.cache.duration) ===
          this.loadedBucket;
        const positions = ready && !this.isLive
            ? [...this.selection]
                .map((id) => this.engine.position(id, this.clock.time))
                .filter((p) => p && p.world === world)
                .map((p) => ({ ...p, time: this.clock.time }))
            : [];
        this.adapter.setPlayers(
          positions,
          this.names,
          this.manifest.registry.players,
        );
        const healthKey = JSON.stringify([
          Math.floor(this.clock.time / 1000),
          positions.map((position) => position.player),
        ]);
        if (healthKey !== this.healthKey) {
          this.healthKey = healthKey;
          const token = (this.healthToken = {});
          Promise.all(
            positions.map(async (position) => [
              position.player,
              await this.telemetryCache.at(position.player, this.clock.time),
            ]),
          ).then((states) => {
            if (this.healthToken !== token || this.isLive) return;
            for (const [player, state] of states)
              this.adapter?.setPlayerVitals(player, state);
          });
        }
        if (world === undefined)
          this.status.textContent =
            "This map has no matching recorded dimension.";
        if (this.lastMap !== this.adapter.mapId) {
          this.lastMap = this.adapter.mapId;
          this.updateOverlays();
        }
      } catch (error) {
        this.report(error);
      }
    }
    updateOverlays() {
      if (
        !this.adapter ||
        !this.cache ||
        !this.manifest ||
        !Number.isFinite(this.clock.time)
      )
        return;
      const { from, to, time } = this.clock,
        world = this.world();
      const full = this.trailMode === Infinity;
      const start = full ? from : Math.max(from, time - this.trailMode);
      const dataKey = JSON.stringify([
        String(this.trailMode),
        this.isLive ? Math.floor(from / this.cache.duration) : from,
        this.isLive ? Math.floor(to / this.cache.duration) : to,
        full ? null : Math.floor(time / this.cache.duration),
      ]);
      if (this.trailDataKey !== dataKey && !this.trailAbort)
        this.loadTrails(dataKey);
      const historyEngine = this.trailDataKey === dataKey ? this.fullTrails : null;
      const engine = this.isLive ? new ReplayEngine(mergePoints([
        { points: [...(historyEngine?.players.values() || [])].flat() },
        { points: this.livePoints },
      ])) : historyEngine;
      const trailKey = JSON.stringify([
        dataKey,
        start,
        full ? to : time,
        [...this.selection],
        world,
        !!engine,
        [...this.names],
      ]);
      if (trailKey !== this.trailKey) {
        this.trailKey = trailKey;
        this.adapter.setTrails(
          this.trailMode && engine
            ? [...this.selection]
                .flatMap((id) => engine.trails(id, start, full ? to : time))
                .filter((line) => line[0].world === world)
            : [],
          this.names,
          this.manifest.registry.players,
        );
      }
      const combined = new Map(
        [...this.rangeEvents, ...this.events, ...(this.isLive ? this.liveEvents : [])].map(
          (event) => [
            JSON.stringify([event.point, event.type, event.payload]),
            event,
          ],
        ),
      );
      const selectedTimelineEvents = [...combined.values()]
        .sort((a, b) => a.point.time - b.point.time)
        .filter(
          (event) =>
            this.selection.has(event.point.player) &&
            event.point.time >= from &&
            event.point.time <= to,
        );
      const timelineEvents = selectedTimelineEvents.filter(
        (event) => !this.disabledEvents.has(event.type),
      );
      const events = visibleEvents(
        timelineEvents,
        {
          from,
          time,
          trailMode: this.trailMode,
          disabled: this.disabledEvents,
        },
      )
        .slice(-500);
      const eventKey = JSON.stringify([
        events,
        world,
        from,
        to,
        [...this.names],
      ]);
      if (this.eventKey !== eventKey) {
        this.eventKey = eventKey;
        this.adapter.setEvents(
          events.filter((event) => event.point.world === world),
          this.names,
          (t) => this.seek(t),
          this.manifest.registry,
        );
      }
      const chatEvents = selectedTimelineEvents
        .filter((event) => ["CHAT", "JOIN", "QUIT", "DEATH"].includes(event.type))
        .slice(-1000);
      const timelineEventKey = JSON.stringify([chatEvents, from, to, [...this.names]]);
      if (this.timelineEventKey !== timelineEventKey) {
        this.timelineEventKey = timelineEventKey;
        const chat = this.querySelector(".history-chat");
        const follow = this.chatPinned;
        chat.replaceChildren();
        for (const event of chatEvents) {
          const row = document.createElement("div");
          let payload;
          try {
            payload =
              typeof event.payload === "string"
                ? JSON.parse(event.payload)
                : event.payload;
          } catch {
            continue;
          }
          const time = document.createElement("button");
          time.type = "button";
          time.className = "history-chat-time";
          time.title = "Go to this message";
          time.textContent = date(event.point.time);
          time.onclick = (click) => { click.stopPropagation(); this.goToEvent(event); };
          const head = document.createElement("img");
          head.className = "history-chat-head";
          head.alt = "";
          const player = this.manifest.registry.players.find(
            (player) => player.id === event.point.player,
          );
          const mapRoot = window.bluemap?.mapViewer?.map?.data?.mapDataRoot;
          if (player?.uuid && mapRoot) head.src = `${mapRoot}/assets/playerheads/${player.uuid}.png`;
          else head.hidden = true;
          head.onerror = () => { head.hidden = true; };
          const message = document.createElement("span");
          const name = this.names.get(event.point.player) || "Player";
          if (event.type !== "CHAT")
            row.classList.add("history-chat-system", "history-chat-" + event.type.toLowerCase());
          message.textContent = chatMessage(event.type, name, payload);
          row.append(time, head, message);
          row.tabIndex = 0;
          row.setAttribute("role", "button");
          row.title = "Show this message on the map";
          row.onclick = () => this.goToEvent(event);
          row.onkeydown = (key) => {
            if (key.key === "Enter" || key.key === " ") {
              key.preventDefault();
              this.goToEvent(event);
            }
          };
          chat.append(row);
        }
        if (!chatEvents.length) {
          const empty = document.createElement("div");
          empty.className = "history-chat-empty";
          empty.textContent = "No chat or player status messages in this range";
          chat.append(empty);
        }
        if (follow) requestAnimationFrame(() => { chat.scrollTop = chat.scrollHeight; });
        const ticks = this.querySelector(".history-events");
        ticks.replaceChildren();
        const indicatorEvents = chatEvents.filter((event) => ["CHAT", "DEATH"].includes(event.type));
        const threshold = ((to - from) * 18) / Math.max(1, ticks.clientWidth || 600);
        for (const cluster of clusterTimelineEvents(indicatorEvents, threshold)) {
          const button = document.createElement("button");
          const hasChat = cluster.some((event) => event.type === "CHAT");
          const hasDeath = cluster.some((event) => event.type === "DEATH");
          button.className = `history-timeline-event ${hasChat && hasDeath ? "history-mixed-tick" : hasDeath ? "history-death-tick" : "history-chat-tick"}`;
          const middle = cluster.reduce((sum, event) => sum + event.point.time, 0) / cluster.length;
          button.style.left = `${((middle - from) / Math.max(1, to - from)) * 100}%`;
          button.style.color = hasChat && hasDeath ? "#eee" : eventColor(hasDeath ? "DEATH" : "CHAT");
          const bubble = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 2h12v9H7l-4 3v-3H2z"/></svg>';
          const skull = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 7a5 5 0 0 1 10 0v4h-2v2H9v-2H7v2H5v-2H3zM5 7h2v2H5zm4 0h2v2H9z"/></svg>';
          button.innerHTML = (hasChat ? bubble : "") + (hasDeath ? skull : "") + (cluster.length > 1 ? `<b>${cluster.length}</b>` : "");
          button.setAttribute("aria-label", `${cluster.length} ${hasChat && hasDeath ? "chat and death" : hasDeath ? "death" : "chat"} event${cluster.length === 1 ? "" : "s"}; click repeatedly to cycle`);
          let current = 0;
          button.onclick = () => {
            const event = cluster[current++ % cluster.length];
            this.goToEvent(event);
            button.title = `${date(event.point.time)} · ${event.type.toLowerCase()} · ${this.names.get(event.point.player) || "Player"}`;
          };
          ticks.append(button);
        }
      }
      const heatKey = JSON.stringify([
        this.heatVersion,
        [...this.selection],
        world,
        this.heatEnabled,
      ]);
      if (heatKey !== this.heatKey) {
        this.heatKey = heatKey;
        if (this.heatEnabled && this.heatRows) {
          const cells = new Map();
          for (const row of this.heatRows)
            if (this.selection.has(row[0]) && row[1] === world) {
              const key = `${row[2]},${row[3]}`,
                old = cells.get(key);
              if (old) old[4] += row[4];
              else cells.set(key, [...row]);
            }
          this.adapter.setHeatmap(
            [...cells.values()],
            this.manifest.cellSize,
            0.55,
          );
        } else this.adapter.clearHeatmap();
      }
    }
    async pollLive() {
      if (!this.isConnected || this.liveLoading) return;
      this.liveLoading = true;
      const controller = new AbortController();
      this.liveAbort = controller;
      try {
        const response = await fetch(
          new URL(`data/live.json?t=${Date.now()}`, base),
          { cache: "no-store", signal: controller.signal },
        );
        if (!response.ok) return;
        const data = await response.json();
        if (
          !this.isConnected ||
          data.protocolVersion !== 2 ||
          !Number.isFinite(data.generatedAt) ||
          Date.now() - data.generatedAt > 10000
        )
          return;
        this.livePoints = Array.isArray(data.points) ? data.points.slice(-20000) : [];
        this.liveEvents = Array.isArray(data.events)
          ? data.events.slice(-1000)
          : [];
        if (!this.manifest) await this.refresh();
        if (this.manifest && data.registry)
          this.manifest.registry = data.registry;
        for (const player of data.registry?.players || []) {
          if (!this.names.has(player.id)) this.selection.add(player.id);
          this.names.set(player.id, player.name);
        }
        if (this.isLive && this.manifest && this.cache) {
          this.clock.refresh(
            this.manifest.earliestTimestamp,
            Math.max(this.manifest.latestTimestamp, data.generatedAt, Date.now()),
          );
          this.clock.seek(this.clock.to);
          this.sync();
          this.render();
          this.updateOverlays();
          const bucket = Math.floor(this.clock.time / this.cache.duration);
          if (bucket !== this.loadedBucket && bucket !== this.pendingBucket)
            this.loadWindow();
        }
      } catch (error) {
        if (error.name !== "AbortError")
          this.status.textContent = "Live updates unavailable";
      } finally {
        this.liveLoading = false;
      }
    }
    renderEventFilters() {
      const list = this.querySelector(".history-event-filter-list");
      list.replaceChildren();
      for (const type of this.eventTypes) {
        const label = document.createElement("label"),
          input = document.createElement("input");
        input.type = "checkbox";
        input.setAttribute(
          "aria-label",
          type.toLowerCase().replaceAll("_", " "),
        );
        input.checked = !this.disabledEvents.has(type);
        input.onchange = () => {
          if (input.checked) this.disabledEvents.delete(type);
          else this.disabledEvents.add(type);
          try {
            localStorage.setItem(
              "player-history-hidden-events",
              JSON.stringify([...this.disabledEvents]),
            );
          } catch {}
          this.updateOverlays();
        };
        label.append(
          input,
          document.createTextNode(type.toLowerCase().replaceAll("_", " ")),
        );
        list.append(label);
      }
    }
    async loadRangeEvents() {
      this.rangeEventAbort?.abort();
      if (!this.cache || !this.manifest) return;
      const controller = new AbortController();
      this.rangeEventAbort = controller;
      const duration = this.cache.duration;
      const first = Math.floor(this.clock.from / duration) * duration;
      const last = Math.floor(this.clock.to / duration) * duration;
      const chunks = Math.floor((last - first) / duration) + 1;
      if (chunks > 5000) {
        this.rangeEvents = [];
        this.status.textContent = "Event and chat history needs a range under 5,000 chunks";
        return;
      }
      const events = [];
      try {
        for (let time = first; time <= last; time += duration) {
          const data = await this.cache.read(time, controller.signal);
          events.push(...data.events);
          if (events.length > 100000) throw Error("Too many events in this range");
        }
        if (controller.signal.aborted) return;
        this.rangeEvents = events.sort((a, b) => a.point.time - b.point.time);
        this.timelineEventKey = null;
        this.eventKey = null;
        this.updateOverlays();
      } catch (error) {
        if (error.name !== "AbortError") this.report(error);
      } finally {
        if (this.rangeEventAbort === controller) this.rangeEventAbort = null;
      }
    }
    async loadTrails(dataKey) {
      const controller = new AbortController();
      this.trailAbort = controller;
      const duration = this.cache.duration;
      const from =
        this.trailMode === Infinity
          ? this.clock.from
          : Math.max(
              this.clock.from,
              Math.floor(this.clock.time / duration) * duration -
                (this.trailMode || 30000),
            );
      const to =
        this.trailMode === Infinity
          ? this.clock.to
          : Math.min(
              this.clock.to,
              (Math.floor(this.clock.time / duration) + 1) * duration,
            );
      const points = [],
        events = [];
      let previousPlayers = new Set();
      this.status.textContent = "Loading trails…";
      try {
        if (Math.floor(to / duration) - Math.floor(from / duration) + 1 > 5000)
          throw Error(
            "Full trails exceed 5,000 recording chunks. Choose a shorter range or 30s / 5m trails.",
          );
        for (
          let t = Math.floor(from / duration) * duration;
          t <= to;
          t += duration
        ) {
          const data = await this.cache.read(t, controller.signal),
            seen = new Set();
          events.push(...data.events);
          if (events.length > 100000)
            throw Error(
              "Too many events in this range. Choose a shorter trail duration.",
            );
          for (const point of data.points) {
            seen.add(point.player);
            if (
              point.flags & CONTEXT &&
              t !== Math.floor(from / duration) * duration
            )
              continue;
            points.push(
              !previousPlayers.has(point.player)
                ? { ...point, flags: point.flags | BREAK }
                : point,
            );
            previousPlayers.add(point.player);
            if (points.length > 100000)
              throw Error(
                "Full trails exceed the browser limit. Use 30s or 5m trails.",
              );
          }
          previousPlayers = seen;
        }
        if (controller.signal.aborted) return;
        this.trailDataKey = dataKey;
        this.overlayEvents = events.sort((a, b) => a.point.time - b.point.time);
        let added = false;
        for (const event of events)
          if (!this.eventTypes.has(event.type)) {
            this.eventTypes.add(event.type);
            added = true;
          }
        if (added) this.renderEventFilters();
        this.fullTrails = new ReplayEngine(
          points.sort((a, b) => a.time - b.time),
        );
        this.status.textContent = this.isLive
          ? "Live · local time"
          : "Historical replay · local time";
      } catch (error) {
        if (error.name !== "AbortError") {
          this.report(error);
          this.trailMode = 0;
          this.sync();
        }
      } finally {
        if (this.trailAbort === controller) {
          this.trailAbort = null;
          if (this.fullTrails) this.updateOverlays();
        }
      }
    }
    async loadHeat() {
      this.heatAbort?.abort();
      const controller = new AbortController();
      this.heatAbort = controller;
      try {
        const plan = heatmapPlan(
            this.clock.from,
            this.clock.to,
            this.manifest.chunkDurationMs,
          ),
          cells = new Map();
        for (const part of plan) {
          const res = await fetch(
            new URL(`data/heatmap/${part.level}/${part.time}.json`, base),
            { signal: controller.signal, cache: "no-store" },
          );
          if (res.status === 404) continue;
          if (!res.ok) throw Error(`Heatmap HTTP ${res.status}`);
          for (const row of await res.json()) {
            const key = row.slice(0, 4).join(":"),
              old = cells.get(key);
            if (old) old[4] += row[4];
            else cells.set(key, [...row]);
            if (cells.size > 100000)
              throw Error("Heatmap exceeds the browser cell limit.");
          }
        }
        if (controller.signal.aborted || !this.opened) return;
        this.heatRows = [...cells.values()];
        this.heatVersion = (this.heatVersion || 0) + 1;
        this.status.textContent = cells.size
          ? "Heatmap · time spent · completed recording chunks"
          : "No completed heatmap data in this range";
        this.updateOverlays();
      } catch (error) {
        this.report(error);
      }
    }
    disconnectedCallback() {
      clearInterval(this.chatTimer);
      clearInterval(this.liveTimer);
      clearInterval(this.refreshTimer);
      clearTimeout(this.seekTimer);
      this.liveAbort?.abort();
      this.manifestAbort?.abort();
      this.heatAbort?.abort();
      this.trailAbort?.abort();
      this.rangeEventAbort?.abort();
      this.activityAbort?.abort();
      this.cache?.clear();
      this.adapter?.dispose();
      cancelAnimationFrame(this.frame);
      this.listeners.abort();
    }
  }
  customElements.define("bluemap-player-replay", ReplayPanel);
  document.body.append(document.createElement("bluemap-player-replay"));
})().catch(console.error);
