const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..'),dist=root+'/bluemap-addon/dist';
const out=process.env.PERF_EVIDENCE_DIR || root+'/build/validation/player-roster';fs.mkdirSync(out,{recursive:true});
const original=JSON.parse(fs.readFileSync(process.env.PERF_MANIFEST)).registry;
const registry={...original,players:[...original.players,
{id:9001,uuid:original.players[0].uuid,name:'Test Overworld'},
{id:9002,uuid:original.players[1].uuid,name:'Test Nether'},
{id:9003,uuid:original.players[0].uuid,name:'Test Offline'}]};
const offlineTime=Date.now()-600000;
function snapshot(){const now=Date.now();return {protocolVersion:2,generatedAt:now,registry,
points:[{player:9001,time:now,world:0,x:-937*32,y:64*32,z:392*32,flags:0},{player:9002,time:now,world:1,x:-1002*32,y:70*32,z:-311*32,flags:0}],
lastLocations:[{player:9003,time:offlineTime,world:0,x:-930*32,y:65*32,z:400*32,flags:2}],events:[],states:{9001:{health:17,maxHealth:40,sneaking:true},9002:{health:20,maxHealth:20,sprinting:true}}};}
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1440,height:900}});const page=await context.newPage();const errors=[],failures=[],results={syntheticPlayers:true,productionChanged:false};
page.on('pageerror',e=>errors.push(e.stack));page.on('requestfailed',r=>failures.push({url:r.url(),error:r.failure()?.errorText}));
await page.route('**/*',async route=>{const u=new URL(route.request().url());let file;
if(/^\/player-history\/player-history(?:-[^/]+)?\.js$/.test(u.pathname))file=dist+'/player-history.js';
else if(/^\/player-history\/player-history(?:-[^/]+)?\.css$/.test(u.pathname))file=dist+'/player-history.css';
else if(process.env.BLUEMAP_WEBAPP && /^\/assets\/index-[^.]+\.js$/.test(u.pathname)){const assets=path.join(process.env.BLUEMAP_WEBAPP,'assets');file=path.join(assets,fs.readdirSync(assets).find(name=>/^index-.*\.js$/.test(name)));}
else if(u.pathname.startsWith('/player-history/modules/'))file=path.join(dist,u.pathname.slice('/player-history/'.length));
else if(/^\/player-history\/data\/(presence|live)\.json$/.test(u.pathname))return route.fulfill({json:snapshot()});
if(file)return route.fulfill({path:file,contentType:file.endsWith('.css')?'text/css':'text/javascript'});
return route.continue();});
const state=()=>page.evaluate(()=>{const p=document.querySelector('bluemap-player-replay');return{map:window.bluemap?.mapViewer.map?.data.id,following:p?.adapter?.following,followingTarget:!!window.bluemap?.mapViewer.controlsManager?.controls?.data?.followingPlayer,players:p?.adapter?.playerPositions?.map(x=>x.player),offline:p?.adapter?.offlineMarkers?.size,cards:[...document.querySelectorAll('.history-player-followbar>button')].map(b=>({id:b.value,text:b.textContent,pressed:b.ariaPressed,dimension:b.dataset.dimension,offline:b.dataset.offline,images:[...b.querySelectorAll('img')].map(i=>({src:i.src,loaded:i.complete&&i.naturalWidth>0})),bounds:b.getBoundingClientRect().toJSON()}))};});
try{
await page.goto('https://map.fpbcraft.com/#world:-937:64:392:377:0:0:0:0:perspective',{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>document.querySelectorAll('.history-player-followbar>button').length===3,{timeout:60000});
await page.waitForTimeout(1500);console.log('roster ready');results.desktop=await state();assert.deepEqual(results.desktop.players,[9001]);assert.equal(results.desktop.offline,1);assert.equal(results.desktop.cards[1].dimension,'minecraft:the_nether');
await page.screenshot({path:out+'/desktop.png'});
await page.evaluate(()=>window.__rosterCard=document.querySelector('.history-player-followbar>button'));
await page.waitForTimeout(2200);results.stableCard=await page.evaluate(()=>window.__rosterCard===document.querySelector('.history-player-followbar>button'));assert.equal(results.stableCard,true);
await page.locator('.history-player-followbar>button[value="9002"]').click();
await page.waitForFunction(()=>{const p=document.querySelector('bluemap-player-replay');return window.bluemap.mapViewer.map?.data.id==='world_the_nether'&&p.adapter.following===9002&&!!window.bluemap.mapViewer.controlsManager.controls.data.followingPlayer;},{timeout:30000});
console.log('foreign follow ready');results.nether=await state();assert.deepEqual(results.nether.players,[9002]);assert.equal(results.nether.offline,0);assert.equal(results.nether.cards.length,3);await page.screenshot({path:out+'/nether.png'});
await page.locator('.history-player-followbar>button[value="9003"]').click();
await page.waitForFunction(()=>window.bluemap.mapViewer.map?.data.id==='world'&&!document.querySelector('bluemap-player-replay').adapter.following,{timeout:30000});
await page.waitForTimeout(1000);console.log('offline location ready');results.offlineClick=await state();assert.equal(results.offlineClick.offline,1);
await page.setViewportSize({width:390,height:844});await page.waitForTimeout(500);await page.screenshot({path:out+'/mobile.png'});results.mobile=await page.evaluate(()=>{const b=document.querySelector('.history-player-followbar').getBoundingClientRect();return{left:b.left,right:b.right,width:innerWidth,scrollWidth:document.querySelector('.history-player-followbar').scrollWidth,overlayLeft:document.querySelector('.world-overlays__button')?.getBoundingClientRect().left};});assert(results.mobile.left>=0&&results.mobile.right<=results.mobile.width);assert(results.mobile.right<=results.mobile.overlayLeft);
await page.evaluate(()=>document.querySelector('bluemap-player-replay').open());
await page.waitForFunction(()=>document.querySelector('bluemap-player-replay').manifest,{timeout:30000});
await page.evaluate(()=>document.querySelector('bluemap-player-replay').seek(1794319284400));
await page.waitForFunction(()=>!document.querySelector('bluemap-player-replay').isLive,{timeout:10000});await page.waitForTimeout(1500);console.log('historical mode ready');results.historical=await state();assert.equal(results.historical.offline,0);assert(!results.historical.cards.some(c=>c.offline==='true'));
await page.evaluate(()=>document.querySelector('bluemap-player-replay').close());await page.waitForFunction(()=>document.querySelector('bluemap-player-replay').isLive&&document.querySelector('bluemap-player-replay').adapter.offlineMarkers.size===1,{timeout:10000});results.afterClose=await state();
assert.equal(errors.length,0,'No map-switch exceptions');results.passed=true;
}catch(e){results.passed=false;results.failure=e.stack;results.lastState=await state().catch(()=>null);await page.screenshot({path:out+'/failure.png'}).catch(()=>{});console.error(e);process.exitCode=1;}
finally{results.errors=errors;results.requestFailures=failures;fs.writeFileSync(out+'/report.json',JSON.stringify(results,null,2));console.log(JSON.stringify({passed:results.passed,failure:results.failure,errors:errors.length,output:out}));await browser.close();}
})();
