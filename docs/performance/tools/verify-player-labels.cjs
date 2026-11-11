// Browser component fixture: eight player pins and the actual pairing copy handler.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..');
const esbuild=require(path.join(root,'bluemap-addon/node_modules/esbuild'));
const out=path.join(root,'build/validation/player-labels');fs.mkdirSync(out,{recursive:true});
(async()=>{
const built=await esbuild.build({stdin:{contents:`import { MapPlayerLabels } from './src/map-player-labels.ts'; import { HistoryChat } from './src/ui/history-chat.tsx'; import { render, h } from 'preact'; import { ReplayPanel } from './src/replay-panel.ts'; window.mountFixture=()=>{const controller=new AbortController(); new MapPlayerLabels(controller.signal); const panel=document.querySelector('bluemap-player-replay'); render(h(HistoryChat), panel); panel.querySelector('.history-chat-panel').hidden=false; const q=name=>panel.querySelector('[name="'+name+'"], [data-control="'+name+'"]'); q('chat-pair-command').textContent='/webchat link FIXTURE'; panel.querySelector('.history-chat-pairing').hidden=false; q('chat-copy').onclick=()=>ReplayPanel.prototype.copyChatPairing.call({q,lifecycle:{signal:controller.signal}}); return controller;};`,resolveDir:path.join(root,'bluemap-addon'),loader:'tsx'},bundle:true,format:'iife',write:false,jsx:'automatic',jsxImportSource:'preact'});
const css=fs.readFileSync(path.join(root,'bluemap-addon/dist/player-history.css'),'utf8');
const face='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path fill="#957255" d="M0 0h32v32H0z"/><path fill="#eee" d="M6 10h6v6H6zm14 0h6v6h-6z"/></svg>');
const pins=Array.from({length:8},(_,i)=>`<div class="${i%2?'bm-marker-player':'history-offline-location'}" distance-data="far" tabindex="0" aria-label="Player ${i+1}${i%2?'':' offline'}" style="position:absolute;left:${10+(i%4)*76}px;top:${80+Math.floor(i/4)*90}px"><img width="32" height="32" src="${face}"><span class="${i%2?'bm-player-name':'history-map-player-label'}">Player ${i+1}${i%2?'':' · Offline'}</span></div>`).join('');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{for(const mobile of [false,true]){
const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:800},isMobile:mobile,hasTouch:mobile});
await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:'https://fixture.invalid'});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('https://fixture.invalid/**',route=>route.fulfill({body:`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#26362c;color:#eee}#map-container{height:300px;position:relative}.bm-marker-player .bm-player-name{position:absolute;top:100%;white-space:nowrap;background:#181818}#map-container .bm-marker-player[distance-data="far"] .bm-player-name{opacity:0}</style><style>${css}</style></head><body><div id="map-container">${pins}</div><bluemap-player-replay></bluemap-player-replay></body></html>`,contentType:'text/html'}));
await page.goto('https://fixture.invalid/');await page.addScriptTag({content:built.outputFiles[0].text});await page.evaluate(()=>{window.__labelsController=window.mountFixture();window.__mapGestures=0;document.querySelector('#map-container').addEventListener('pointerdown',()=>window.__mapGestures++);});
const markers=page.locator('.history-offline-location,.bm-marker-player');const labelAt=index=>markers.nth(index).locator('.history-map-player-label,.bm-player-name');
for(let i=0;i<8;i++)assert.equal(await labelAt(i).isVisible(),false);
if(mobile){for(let i=0;i<8;i++){await markers.nth(i).tap();assert.equal(await labelAt(i).isVisible(),true);assert.equal(await page.locator('.history-map-player-label:visible,.bm-player-name:visible').count(),1);}await page.locator('#map-container').tap({position:{x:350,y:275}});for(let i=0;i<8;i++)assert.equal(await labelAt(i).isVisible(),false);assert.equal(await page.evaluate(()=>window.__mapGestures),1);}
else{for(let i=0;i<8;i++){await markers.nth(i).hover();assert.equal(await labelAt(i).isVisible(),true);assert.equal(await labelAt(i).evaluate(n=>getComputedStyle(n).opacity),'1');await page.mouse.move(1200,280);assert.equal(await labelAt(i).isVisible(),false);}await markers.first().focus();assert.equal(await labelAt(0).isVisible(),true);}
await page.getByRole('button',{name:'Copy command',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[name="chat-copy-status"]').textContent==='Copied!');
assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'/webchat link FIXTURE');
await page.screenshot({path:path.join(out,mobile?'mobile.png':'desktop.png')});await page.evaluate(()=>window.__labelsController.abort());assert.equal(errors.length,0);
fs.writeFileSync(path.join(out,mobile?'mobile.json':'desktop.json'),JSON.stringify({passed:true,mobile,players:8,clipboardCommandCopied:true,errors},null,2));console.log(JSON.stringify({passed:true,mobile,players:8,clipboard:true}));await context.close();}}
finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
