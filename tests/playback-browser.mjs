import {chromium} from '@playwright/test';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {Game} from '../server/game.js';
import {createServer} from '../server/http.js';
import {makeSpeedway} from '../track.js';

// Instrument the real draw calls only in this test bundle, never in the published app.
const hook=`
const draw=SpeedwayScene.prototype.draw;
window.playbackFrames=[];
SpeedwayScene.prototype.draw=function(state,race,time,now,...args){
 if(race?.live)window.playbackFrames.push({now:performance.now(),raf:now,time,head:race.availableTime,distance:state.runners[0].distance});
 return draw.call(this,state,race,time,now,...args);
};`;
const bundle=await build({stdin:{contents:readFileSync('app.js','utf8')+hook,resolveDir:process.cwd(),sourcefile:'app.js'},bundle:true,format:'esm',write:false});
const game=new Game(':memory:',{bettingMs:0,track:makeSpeedway()}),account=game.register('PlaybackDriver','local-jitter-test-password'),code=game.create(account.user.id);
game.start(account.user.id,code);
const server=createServer(game,{site:path.resolve('site')});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
let packets=0;
page.on('pageerror',error=>errors.push(error.message));
try{
 await page.addInitScript(token=>localStorage.setItem('carrace.session.v1',token),account.token);
 await page.route('**/app-*.js',route=>route.fulfill({contentType:'text/javascript',body:bundle.outputFiles[0].text}));
 await page.route('**/api/**',async route=>{
  const response=await route.fetch(),url=new URL(route.request().url());
  const delay=url.pathname===`/api/rooms/${code}`?[650,100,800,250][packets++%4]:url.pathname==='/api/me'?450:0;
  if(delay)await new Promise(r=>setTimeout(r,delay));
  await route.fulfill({response});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'domcontentloaded'});
 await page.locator('#track[data-car-models="ready"]').waitFor();
 await page.locator('#ability:not([disabled])').waitFor();await page.locator('#ability').click();
 await page.waitForTimeout(22000);
 const frames=await page.evaluate(()=>playbackFrames.filter(frame=>frame.distance>10));
 mkdirSync('review/performance',{recursive:true});writeFileSync('review/performance/network-frames.json',JSON.stringify(frames));
 assert.ok(frames.length>200);assert.ok(packets>=10);
 let stalls=0,maxRate=0;
 for(let i=1;i<frames.length;i++){
  const before=frames[i-1],after=frames[i],dt=(after.now-before.now)/1000,advance=after.time-before.time;
  assert.ok(after.time<=after.head+1e-8,'only confirmed motion reaches the renderer');
  assert.ok(advance>=0,'cars never rewind');
  assert.ok(advance<=dt*1.12+.003,`arriving snapshots never teleport cars forward: ${JSON.stringify({before,after,advance,dt})}`);
  maxRate=Math.max(maxRate,advance/dt);
  if(after.distance-before.distance<.001)stalls++;
 }
 assert.ok(stalls<frames.length*.01,'movement remains continuous under delayed, uneven room responses');
 assert.equal(game.profile(account.user.id).coins,925,'overlapping polling preserves the single paid ability');
 assert.deepEqual(errors,[]);
 const report={passed:true,roomPackets:packets,frames:frames.length,stalls,maxPlaybackRate:maxRate,checks:['real renderer with delayed room and account responses','smooth causal movement','no forward jumps or rewinds','paid ability during overlapping polling','no browser errors']};
 mkdirSync('review/performance',{recursive:true});writeFileSync('review/performance/network-browser.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));game.close();}
