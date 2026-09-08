// Run against the disposable BlueMap server with a Chromium page CDP endpoint.
// node tests/browser-verification.mjs http://127.0.0.1:PORT
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
const targets = await (await fetch(process.argv[2] + "/json/list")).json();
const target = targets.find(
  (t) => t.type === "page" && t.url.startsWith("http://127.0.0.1:8100"),
);
assert.ok(target, "Open the disposable BlueMap page first");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) =>
  socket.addEventListener("open", resolve, { once: true }),
);
let nextId = 0;
const calls = new Map(),
  errors = [],
  checks = [];
socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  if (message.method === "Runtime.exceptionThrown")
    errors.push(message.params.exceptionDetails);
  if (message.id) {
    const call = calls.get(message.id);
    calls.delete(message.id);
    message.error
      ? call.reject(Error(message.error.message))
      : call.resolve(message.result);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    calls.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    replMode: true,
  });
  if (result.exceptionDetails)
    throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const check = (condition, message) => {
  assert.ok(condition, message);
  checks.push(message);
};
const rect = (selector) =>
  evaluate(
    `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`,
  );
const mouse = (type, x, y) =>
  send("Input.dispatchMouseEvent", {
    type,
    x,
    y,
    button: "left",
    buttons: type === "mouseReleased" ? 0 : 1,
    clickCount: 1,
  });
const state = () =>
  evaluate(
    "({time:p.clock.time,from:p.clock.from,to:p.clock.to,rate:p.clock.rate,playing:p.clock.isPlaying,shuttling:p.clock.isShuttling,cache:p.cache.cache.size})",
  );
try {
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Network.setCacheDisabled", { cacheDisabled: true });
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.reload", { ignoreCache: true });
  await wait(1800);
  await evaluate(
    "window.p=document.querySelector('bluemap-player-replay'); p.open()",
  );
  await wait(400);
  let s = await state();
  check(
    s.time === s.to && s.from === pEarliest(),
    "opens at latest with the available short range",
  );
  function pEarliest() {
    return 1788571200000;
  }
  check(
    await evaluate(
      "p.querySelector('.history-custom-dates').hidden && !!p.q('speed') && !!p.q('range')",
    ),
    "compact speed and range selectors replace date configuration",
  );
  check(
    await evaluate(
      "p.events.length === 10 && p.adapter.events.children.length === 8",
    ),
    "all recorded event types enabled on map",
  );
  const timeline = await rect('bluemap-player-replay [name="timeline"]');
  await mouse(
    "mousePressed",
    timeline.x + timeline.width * 0.4,
    timeline.y + 14,
  );
  await mouse(
    "mouseMoved",
    timeline.x + timeline.width * 0.65,
    timeline.y + 14,
  );
  await wait(180);
  check((await state()).time < s.to, "timeline seeks before pointer release");
  check(
    await evaluate("!p.querySelector('.history-tooltip').hidden"),
    "dragging exposes timestamp tooltip",
  );
  await mouse(
    "mouseReleased",
    timeline.x + timeline.width * 0.65,
    timeline.y + 14,
  );
  await evaluate("p.seek(p.clock.from + 150000)");
  const shuttle = await rect(".history-shuttle-track");
  let before = (await state()).time;
  await mouse("mousePressed", shuttle.x + shuttle.width * 0.75, shuttle.y + 1);
  await wait(250);
  check(
    (await state()).time > before && (await state()).rate > 1,
    "held shuttle advances while normally paused",
  );
  await mouse("mouseMoved", shuttle.x - 80, shuttle.y - 60);
  before = (await state()).time;
  await wait(250);
  check(
    (await state()).time < before && (await state()).rate === -120,
    "pointer capture rewinds outside shuttle",
  );
  await mouse("mouseReleased", shuttle.x - 80, shuttle.y - 60);
  s = await state();
  check(
    s.rate === 0 && !s.shuttling && !s.playing,
    "mouse release restores paused state",
  );
  await evaluate("p.clock.isPlaying=true");
  await mouse("mousePressed", shuttle.x + shuttle.width * 0.25, shuttle.y + 1);
  await mouse("mouseReleased", shuttle.x + shuttle.width * 0.25, shuttle.y + 1);
  check((await state()).rate === 1, "release restores normal forward playback");
  await evaluate("p.clock.isPlaying=false; p.q('players').click()");
  check(
    await evaluate("!p.querySelector('.history-popover').hidden"),
    "player popover opens",
  );
  await evaluate("p.querySelector('.history-player-list input').click()");
  await wait(100);
  check(
    await evaluate("p.selection.size === 0"),
    "player filtering updates selection",
  );
  await evaluate("p.q('all').click()");
  await mouse("mousePressed", 600, 100);
  await mouse("mouseReleased", 600, 100);
  check(
    await evaluate("p.querySelector('.history-popover').hidden"),
    "outside click closes players",
  );
  await evaluate(
    "p.q('trails').value='Infinity'; p.q('trails').dispatchEvent(new Event('change'))",
  );
  await wait(400);
  check(
    await evaluate("!!p.fullTrails"),
    "full trails load through compact control",
  );
  await evaluate("p.q('heat').click()");
  await wait(400);
  check(
    await evaluate("p.heatEnabled && p.heatRows.length > 0"),
    "heatmap toggle loads same-range aggregate",
  );
  await evaluate("p.q('heat').click()");
  check(await evaluate("!p.heatEnabled"), "heatmap toggles off");
  // Intercept only this page's fetch function, keeping server data unchanged.
  await evaluate(`window.originalFetch=window.fetch; window.fixture=structuredClone(p.manifest);
    fixture.earliestTimestamp=fixture.latestTimestamp-72*3600000;
    window.fetch=(url,options)=>String(url).includes("manifest.json")?Promise.resolve(new Response(JSON.stringify(fixture))):originalFetch(url,options);
    p.seek(p.clock.to); await p.refresh();`);
  s = await state();
  check(
    s.to - s.from === 48 * 3600000,
    "long dataset is limited to rolling 48 hours",
  );
  await evaluate("fixture.latestTimestamp+=5000; await p.refresh()");
  check(
    (await state()).time === s.to + 5000,
    "manifest refresh follows latest",
  );
  await evaluate("p.seek(p.clock.to-8*3600000)");
  before = (await state()).time;
  await evaluate(
    "fixture.latestTimestamp+=5000; fixture.registry.players.push({id:2,name:'New player'}); await p.refresh()",
  );
  check(
    (await state()).time === before,
    "refresh preserves historical absolute timestamp",
  );
  check(
    await evaluate("p.selection.has(2) && p.names.get(2)==='New player'"),
    "refresh discovers and selects new players",
  );
  await evaluate(
    "fixture.earliestTimestamp=fixture.latestTimestamp-60*86400000; await p.refresh()",
  );
  for (const [choice, days] of [
    ["1", 1],
    ["7", 7],
    ["30", 30],
    ["all", 60],
  ]) {
    await evaluate(`p.q('range').value='${choice}'; await p.changeRange()`);
    const rangeState = await state();
    check(
      rangeState.to - rangeState.from === days * 86400000,
      `range selector applies ${choice}`,
    );
  }
  await evaluate(
    "p.q('range').value='custom'; p.q('range').dispatchEvent(new Event('change')); p.q('days').value='12'; p.querySelector('.history-custom-days').requestSubmit()",
  );
  check(
    await evaluate("p.clock.to-p.clock.from===12*86400000"),
    "custom number of days applies",
  );
  await evaluate(
    "p.q('days').value='0'; p.querySelector('.history-custom-days').requestSubmit()",
  );
  check(
    await evaluate("p.clock.to-p.clock.from===12*86400000"),
    "invalid custom days leave active range unchanged",
  );
  await evaluate(`p.q('range').value='dates'; p.q('range').dispatchEvent(new Event('change'));
    window.fixedEnd=p.manifest.latestTimestamp-5*86400000;
    const local=t=>new Date(t-new Date(t).getTimezoneOffset()*60000).toISOString().slice(0,19);
    p.q('date-from').value=local(fixedEnd-2*86400000); p.q('date-to').value=local(fixedEnd);
    p.querySelector('.history-custom-dates').requestSubmit();`);
  check(
    await evaluate(
      "p.clock.to-p.clock.from===2*86400000 && p.clock.to<p.manifest.latestTimestamp",
    ),
    "custom date pickers apply a historical interval",
  );
  const fixedTime = await evaluate("p.clock.to");
  await evaluate("fixture.latestTimestamp+=10000; await p.refresh()");
  check(
    (await state()).to === fixedTime,
    "custom date interval stays fixed on manifest refresh",
  );
  await evaluate(
    "p.q('date-to').value=p.q('date-from').value; p.querySelector('.history-custom-dates').requestSubmit()",
  );
  check(
    (await state()).to === fixedTime,
    "invalid date order preserves previous interval",
  );
  await evaluate(
    "p.q('range').value='2'; p.q('range').dispatchEvent(new Event('change')); window.fetch=window.originalFetch; await p.refresh(true)",
  );
  await evaluate(
    "p.seek(p.clock.from+150000); p.q('speed').value='8'; p.q('speed').dispatchEvent(new Event('change')); p.clock.isPlaying=true",
  );
  before = (await state()).time;
  await wait(500);
  check(
    (await state()).time - before >= 1000 && (await state()).rate === 8,
    "speed selector advances normal playback at 8x",
  );
  const selectedShuttle = await rect(".history-shuttle-track");
  await mouse(
    "mousePressed",
    selectedShuttle.x + selectedShuttle.width * 0.25,
    selectedShuttle.y + 1,
  );
  await mouse(
    "mouseReleased",
    selectedShuttle.x + selectedShuttle.width * 0.25,
    selectedShuttle.y + 1,
  );
  check((await state()).rate === 8, "shuttle release restores selected speed");
  await evaluate(
    "p.clock.isPlaying=false; p.q('speed').value='1'; p.q('speed').dispatchEvent(new Event('change'))",
  );
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true });
  await wait(150);
  const panel = await rect("bluemap-player-replay section");
  check(
    panel.x >= 0 && panel.x + panel.width <= 390,
    "mobile panel stays inside viewport",
  );
  const zoom = await rect("#zoom-buttons");
  check(
    zoom.y + zoom.height <= panel.y,
    "BlueMap zoom buttons remain clear of mobile transport",
  );
  await evaluate("p.seek(p.clock.from+150000)");
  const touch = await rect(".history-shuttle-track");
  before = (await state()).time;
  await send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: touch.x + touch.width * 0.25, y: touch.y + 1 }],
  });
  await wait(200);
  check(
    (await state()).time < before && (await state()).shuttling,
    "touch shuttle rewinds",
  );
  await send("Input.dispatchTouchEvent", {
    type: "touchCancel",
    touchPoints: [],
  });
  check(
    (await state()).rate === 0 && !(await state()).shuttling,
    "touch cancellation restores pause immediately",
  );
  const mobileTimeline = await rect('bluemap-player-replay [name="timeline"]');
  await send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      {
        x: mobileTimeline.x + mobileTimeline.width * 0.4,
        y: mobileTimeline.y + 14,
      },
    ],
  });
  await send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      {
        x: mobileTimeline.x + mobileTimeline.width * 0.6,
        y: mobileTimeline.y + 14,
      },
    ],
  });
  await wait(150);
  check(
    (await state()).time < (await state()).to,
    "touch timeline seeks while held",
  );
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await evaluate("p.seek(p.clock.from+180000)");
  await wait(250);
  const mobileShot = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(
    "outputs/history-redesign-mobile.png",
    Buffer.from(mobileShot.data, "base64"),
  );
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await wait(150);
  const desktopShot = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(
    "outputs/history-redesign-desktop.png",
    Buffer.from(desktopShot.data, "base64"),
  );
  check(
    await evaluate("p.q('trails').options.length===8"),
    "eight trail choices are available",
  );
  await evaluate(`p.clock.isPlaying=false; window.savedMode=p.trailMode; p.trailMode=0; window.originalOverlays=p.updateOverlays; p.updateOverlays=()=>{};
    window.sampleLine=[{player:1,time:p.clock.from,x:-3200,y:0,z:0,world:0,flags:0},{player:1,time:p.clock.from+10000,x:3200,y:0,z:0,world:0,flags:0}];
    p.adapter.setTrails([sampleLine,sampleLine.map(q=>({...q,player:2,z:3200}))], new Map([[1,'First player'],[2,'Second player']]));
    p.adapter.setEvents([],p.names,()=>{});
    window.hoverPoint=new BlueMap.Three.Vector3(0,0,0).project(bluemap.mapViewer.camera);
    window.hoverScreen={x:(hoverPoint.x+1)/2*innerWidth,y:(1-hoverPoint.y)/2*innerHeight};`);
  check(
    await evaluate(
      "p.adapter.trails.children[0].line.color.getHex()!==p.adapter.trails.children[1].line.color.getHex()",
    ),
    "rendered trails use different player colors",
  );
  const hoverScreen = await evaluate("hoverScreen");
  await send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: hoverScreen.x,
    y: hoverScreen.y,
    buttons: 0,
  });
  await wait(100);
  check(
    await evaluate(
      "!p.adapter.tooltip.hidden && p.adapter.tooltip.textContent.includes('First player') && p.adapter.tooltip.textContent.includes('Trail')",
    ),
    "hovering a rendered trail shows player and time details",
  );
  await evaluate(
    "p.adapter.setEvents([{type:'DEATH',point:{...sampleLine[0],x:0},payload:'Test event'}],new Map([[1,'First player']]),()=>{})",
  );
  await wait(100);
  const eventBox = await rect(".history-event");
  await send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: eventBox.x + eventBox.width / 2,
    y: eventBox.y + eventBox.height / 2,
    buttons: 0,
  });
  await wait(100);
  check(
    await evaluate(
      "!p.adapter.tooltip.hidden && p.adapter.tooltip.textContent.includes('death') && p.adapter.tooltip.textContent.includes('Test event')",
    ),
    "hovering an event shows type, player, position and detail",
  );
  await evaluate("p.updateOverlays=window.originalOverlays; p.close()");
  check(
    await evaluate("p.adapter===null && !p.clock.isPlaying"),
    "collapse disposes historical overlays",
  );
  await evaluate("await p.open()");
  check(
    (await state()).time === (await state()).to,
    "reopening starts at latest",
  );
  check(errors.length === 0, "no uncaught browser exceptions");
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
} finally {
  socket.close();
}
