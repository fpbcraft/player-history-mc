const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..'),dist=root+'/bluemap-addon/dist';
const out=process.env.PERF_EVIDENCE_DIR || root+'/build/validation/compact-roster';fs.mkdirSync(out,{recursive:true});
const original=JSON.parse(fs.readFileSync(process.env.PERF_MANIFEST)).registry;
const fixturePlayers=Array.from({length:8},(_,i)=>({id:9001+i,uuid:original.players[i%original.players.length].uuid,name:i===6?'VeryLongPlayerName':`Player ${i+1}`}));
const registry={...original,players:[...original.players,...fixturePlayers]};
const offlineTime=Date.now()-600000;
function snapshot(){const now=Date.now();return {protocolVersion:2,generatedAt:now,registry,
points:fixturePlayers.slice(0,7).map((p,i)=>({player:p.id,time:now,world:0,x:(-937+i)*32,y:64*32,z:392*32,flags:0})),
lastLocations:[{player:9008,time:offlineTime,world:0,x:-930*32,y:65*32,z:400*32,flags:2}],events:[],
states:Object.fromEntries(fixturePlayers.map(p=>[p.id,{health:17,maxHealth:20,sneaking:true,sprinting:true}]))};}
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1280,height:800}});const page=await context.newPage();const errors=[],failures=[],results={syntheticPlayers:true,productionChanged:false};
page.on('pageerror',e=>errors.push(e.stack));page.on('requestfailed',r=>failures.push({url:r.url(),error:r.failure()?.errorText}));
await page.route('**/*',async route=>{const u=new URL(route.request().url());let file;
if(u.pathname==='\/assets/bluemap3d/bluemap3d.js')return route.fulfill({body:'/* Bulk objects omitted in this isolated roster layout fixture. */',contentType:'text/javascript'});
if(/^\/player-history\/player-history(?:-[^/]+)?\.js$/.test(u.pathname))file=dist+'/player-history.js';
else if(/^\/player-history\/player-history(?:-[^/]+)?\.css$/.test(u.pathname))file=dist+'/player-history.css';
else if(process.env.BLUEMAP_WEBAPP && /^\/assets\/index-[^.]+\.js$/.test(u.pathname)){const assets=path.join(process.env.BLUEMAP_WEBAPP,'assets');file=path.join(assets,fs.readdirSync(assets).find(name=>/^index-.*\.js$/.test(name)));}
else if(u.pathname.startsWith('/player-history/modules/'))file=path.join(dist,u.pathname.slice('/player-history/'.length));
else if(/^\/player-history\/data\/(presence|live)\.json$/.test(u.pathname))return route.fulfill({json:snapshot()});
if(file)return route.fulfill({path:file,contentType:file.endsWith('.css')?'text/css':'text/javascript'});
return route.continue();});
const state=()=>page.evaluate(()=>{const p=document.querySelector('bluemap-player-replay');return{map:window.bluemap?.mapViewer.map?.data.id,following:p?.adapter?.following,followingTarget:!!window.bluemap?.mapViewer.controlsManager?.controls?.data?.followingPlayer,players:p?.adapter?.playerPositions?.map(x=>x.player),offline:p?.adapter?.offlineMarkers?.size,cards:[...document.querySelectorAll('.history-player-followbar>button')].map(b=>({id:b.value,text:b.textContent,pressed:b.ariaPressed,dimension:b.dataset.dimension,offline:b.dataset.offline,images:[...b.querySelectorAll('img')].map(i=>({src:i.src,loaded:i.complete&&i.naturalWidth>0})),bounds:b.getBoundingClientRect().toJSON()}))};});
const geometry=()=>page.evaluate(()=>{const strip=document.querySelector('.history-player-followbar'),bar=strip.getBoundingClientRect(),overlay=document.querySelector('.world-overlays__button').getBoundingClientRect();return{bar:bar.toJSON(),overlay:overlay.toJSON(),viewport:{width:innerWidth,height:innerHeight},documentWidth:document.documentElement.scrollWidth,cards:[...strip.querySelectorAll('button')].map(b=>({id:b.value,bounds:b.getBoundingClientRect().toJSON()}))};});
const details=page.locator('.history-roster-details');
const faces=()=>page.locator('.history-player-followbar .history-roster-face').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().width));
const namesFit=()=>page.locator('.history-roster-name').evaluateAll(nodes=>nodes.every(n=>n.scrollWidth<=n.clientWidth+1&&n.scrollHeight<=n.clientHeight+1&&getComputedStyle(n).textOverflow!=='ellipsis'));
const cdp=await context.newCDPSession(page);
const touch=async locator=>{await locator.scrollIntoViewIfNeeded();const box=await locator.boundingBox();const x=box.x+box.width/2,y=box.y+box.height/2;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});};
try{
await page.goto('https://map.fpbcraft.com/#world:-937:64:392:377:0:0:0:0:perspective',{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>document.querySelectorAll('.history-player-followbar>button').length===8,null,{timeout:60000});
await page.waitForTimeout(500);
assert.equal(await page.evaluate(()=>matchMedia('(hover: hover) and (pointer: fine)').matches),true);
results.desktopCollapsed=await geometry();assert((await faces()).every(w=>Math.abs(w-22)<.05));assert(results.desktopCollapsed.bar.height<=42);
const unboxed=await page.locator('.history-player-followbar').evaluate(root=>{const style=getComputedStyle(root);return style.backgroundColor!=='rgba(0, 0, 0, 0)'&&style.scrollbarWidth==='none'&&[...root.querySelectorAll('button')].every(b=>getComputedStyle(b).backgroundColor==='rgba(0, 0, 0, 0)'&&getComputedStyle(b).borderWidth==='0px');});assert.equal(unboxed,true);
await page.screenshot({path:out+'/desktop-collapsed.png'});
const first=page.locator('.history-player-followbar>button[value="9001"]');
let box=await first.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);assert.equal(await details.isVisible(),false);
await page.mouse.click(box.x+box.width/2,box.y+box.height/2);await page.waitForTimeout(90);results.animationMidpoint=(await faces())[0];assert(results.animationMidpoint>22&&results.animationMidpoint<32);
await page.waitForTimeout(250);results.desktopExpanded=await geometry();results.expandedHeadWidths=await faces();assert(results.expandedHeadWidths.every(w=>Math.abs(w-32)<.05));assert.equal(await namesFit(),true);
await page.screenshot({path:out+'/desktop-expanded.png'});
await first.hover();await details.waitFor({state:'visible'});assert.equal(await details.innerText(),'17 / 20 HP');
await first.click();await page.mouse.move(5,300);assert.equal(await details.isVisible(),false); // Desktop clicks never pin details.
await first.hover();await page.screenshot({path:out+'/desktop-details.png'});
await page.keyboard.press('Escape');assert.equal(await details.isVisible(),false);
await page.setViewportSize({width:390,height:844});await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await page.waitForTimeout(300);
assert.equal(await page.evaluate(()=>matchMedia('(hover: hover) and (pointer: fine)').matches),false);
results.mobileCollapsed=await geometry();assert((await faces()).every(w=>Math.abs(w-22)<.05));assert(results.mobileCollapsed.cards.every(c=>c.bounds.right<=results.mobileCollapsed.bar.right));
assert(results.mobileCollapsed.bar.right<=results.mobileCollapsed.overlay.left);assert(results.mobileCollapsed.documentWidth<=390);
await page.screenshot({path:out+'/mobile-collapsed.png'});
await touch(first);await page.waitForTimeout(300);assert.equal(await namesFit(),true);assert.equal(await details.isVisible(),false);
results.mobileExpanded=await geometry();await page.screenshot({path:out+'/mobile-expanded.png'});
results.mobileAccessiblePlayers=[];
for(const player of fixturePlayers){
 const button=page.locator(`.history-player-followbar>button[value="${player.id}"]`);
 await touch(button);await details.waitFor({state:'visible'});
 const text=await details.innerText();assert(player.id===9008? /^Seen \d{2}:\d{2}$/.test(text):text==='17 / 20 HP');
 const bounds=await details.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=results.mobileExpanded.overlay.left&&bounds.y>=0&&bounds.y+bounds.height<=844);
 results.mobileAccessiblePlayers.push(player.id);
}
await page.screenshot({path:out+'/mobile-details.png'});
await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:20,y:350}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
await page.waitForTimeout(300);assert.equal(await details.isVisible(),false);assert((await faces()).every(w=>Math.abs(w-22)<.05));
assert.equal(errors.length,0);results.passed=true;
}catch(e){results.passed=false;results.failure=e.stack;results.lastState=await state().catch(()=>null);await page.screenshot({path:out+'/failure.png'}).catch(()=>{});console.error(e);process.exitCode=1;}
finally{results.errors=errors;results.requestFailures=failures;fs.writeFileSync(out+'/report.json',JSON.stringify(results,null,2));console.log(JSON.stringify({passed:results.passed,failure:results.failure,errors:errors.length,output:out}));await browser.close();}
})();
