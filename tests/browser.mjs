import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {Game} from '../server/game.js';
import {makeSpeedway} from '../track.js';
import {createServer} from '../server/http.js';
import {raceFinishedAt} from '../server/race-simulation.js';
const dir=mkdtempSync(path.join(tmpdir(),'carrace-browser-'));mkdirSync('review',{recursive:true});
let now=Date.now();const game=new Game(path.join(dir,'browser.sqlite'),{clock:()=>now,bettingMs:30000,track:makeSpeedway()});
const backend=createServer(game,{site:path.resolve('site')});await new Promise(r=>backend.listen(0,'127.0.0.1',r));
// Reject root requests. This exercises the exact /carrace/ prefix used in production.
const proxy=http.createServer((req,res)=>{if(!req.url.startsWith('/carrace/')){res.writeHead(404);res.end('outside CarRace');return;}const upstream=http.request({hostname:'127.0.0.1',port:backend.address().port,path:req.url.slice('/carrace'.length),method:req.method,headers:req.headers},u=>{res.writeHead(u.statusCode,u.headers);u.pipe(res);});req.pipe(upstream);});await new Promise(r=>proxy.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true});const a=await browser.newContext({viewport:{width:1440,height:1100}}),b=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const p=await a.newPage(),q=await b.newPage(),errors=[],outside=[];
for(const page of [p,q]){page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).origin===baseOrigin&&!new URL(r.url()).pathname.startsWith('/carrace/'))outside.push(r.url());});}
const baseOrigin=`http://127.0.0.1:${proxy.address().port}`,url=baseOrigin+'/carrace/';
async function register(page,name,driver){await page.goto(url,{waitUntil:'networkidle'});await page.getByRole('button',{name:`Choose ${driver}`}).click();await page.locator('#account').click();await page.locator('#username').fill(name);await page.locator('#password').fill('browser-stock-car-123');await page.locator('#auth-submit').click();await page.locator('#auth-dialog').waitFor({state:'hidden'});await page.locator('.room-code').waitFor();}
try{
 await p.goto(url,{waitUntil:'networkidle'});await p.locator('#loading').waitFor({state:'hidden'});assert.equal(await p.locator('.racer-card').count(),7);await p.screenshot({path:'review/browser-desktop.png',fullPage:true});
 await p.getByRole('button',{name:'Practice race'}).click();await p.locator('#ability:not([disabled])').waitFor();await p.locator('#ability').click();await p.waitForTimeout(300);assert.match(await p.locator('#ability').textContent(),/USED/);await p.getByRole('button',{name:'Chase',exact:true}).click();await p.waitForTimeout(700);await p.screenshot({path:'review/browser-chase.png',fullPage:true});
 // Reload clears the exhibition before creating saved club accounts.
 await register(p,'CarRacerOne','Duke Ironhart');await register(q,'CarRacerTwo','Rowdy Candy');
 const first=game.one('SELECT * FROM users WHERE username=?','CarRacerOne'),second=game.one('SELECT * FROM users WHERE username=?','CarRacerTwo'),code=game.membership(first.id);assert.equal(game.membership(second.id),code);
 assert.equal(first.car,'ironhart');assert.equal(second.car,'candy');
 await p.getByRole('button',{name:'Garage',exact:true}).click();await p.locator('[data-upgrade="stride"]').click();await p.waitForTimeout(500);assert.equal(game.profile(first.id).upgrades.stride,1);assert.equal(game.profile(first.id).coins,910);
 await p.getByRole('button',{name:'Race club',exact:true}).click();await p.getByRole('button',{name:'Open next race',exact:false}).click();await q.locator('#bet-form').waitFor();await p.getByRole('button',{name:'Race club',exact:true}).click();await p.locator('#bet-form').waitFor();
 await p.locator('#bet-form [name="car"]').selectOption('ironhart');await p.locator('#bet-form [name="stake"]').fill('25');await p.getByRole('button',{name:'Place bet',exact:true}).click();
 await q.locator('#bet-form [name="car"]').selectOption('candy');await q.locator('#bet-form [name="kind"]').selectOption('show');await q.locator('#bet-form [name="stake"]').fill('50');await q.getByRole('button',{name:'Place bet',exact:true}).click();await q.waitForTimeout(400);
 assert.equal(game.raceBets(game.latest(code).id).length,2);assert.equal(game.room(first.id,code).race.definition,null);
 await p.screenshot({path:'review/browser-betting.png',fullPage:true});await q.screenshot({path:'review/browser-mobile-club.png',fullPage:true});
 now=game.latest(code).starts+18000;game.tick();await p.getByRole('button',{name:'The circuit',exact:true}).click();await q.getByRole('button',{name:'The circuit',exact:true}).click();await p.locator('#ability:not([disabled])').waitFor();await q.locator('#ability:not([disabled])').waitFor();
 await p.locator('#ability').click();await q.locator('#ability').click();await p.waitForTimeout(600);assert.equal(game.powerUses(game.latest(code).id).length,2);assert.equal(game.profile(first.id).coins,910-25-75);assert.equal(game.profile(second.id).coins,1000-50-75);
 assert.deepEqual(game.room(first.id,code).race.definition,game.room(second.id,code).race.definition);await q.screenshot({path:'review/browser-mobile-race.png',fullPage:true});
 const def=JSON.parse(game.latest(code).definition);now=game.latest(code).starts+(raceFinishedAt(def)+1)*1000;game.tick();await p.waitForTimeout(1600);
 assert.equal(game.room(first.id,code).race.phase,'results');for(const u of [first,second]){const before=game.profile(u.id),own=game.room(u.id,code).race.results.find(r=>r.userId===u.id),ticket=game.room(u.id,code).race.bets[0];assert.equal(before.coins,1000-(u.id===first.id?90+25:50)-75+own.prize+ticket.payout);game.tick();assert.deepEqual(game.profile(u.id),before);}
 await p.getByRole('button',{name:'Past bets',exact:true}).click();await p.locator('.history-card').waitFor();assert.equal(await p.locator('.history-card').count(),1);await p.screenshot({path:'review/browser-history.png',fullPage:true});
 await p.reload({waitUntil:'networkidle'});await p.waitForTimeout(1000);assert.match(await p.locator('#account').textContent(),/CarRacerOne/);await q.getByRole('button',{name:'Garage',exact:true}).click();assert.equal(await q.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await q.screenshot({path:'review/browser-mobile-garage.png',fullPage:true});
 const file=game.db.location();const balances=[game.profile(first.id),game.profile(second.id)];await a.close();await b.close();await new Promise(r=>backend.close(r));game.close();const restored=new Game(file,{clock:()=>now});assert.deepEqual([restored.profile(first.id),restored.profile(second.id)],balances);assert.equal(restored.room(first.id,code).race.bets.length,1);restored.close();
 assert.deepEqual(errors,[]);assert.deepEqual(outside,[]);const report={passed:true,checks:['desktop 3D and seven-car roster','practice and one signature ability','independent desktop/mobile accounts','shared room','saved engine upgrade','Win/Show bets','no future race data','two manual abilities and correct coin fees','synchronized results','exactly-once settlement','only bet races in history','session reload','SQLite close/reopen persistence','no mobile overflow','no root Laravel API requests','no browser errors']};writeFileSync('review/browser-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();await new Promise(r=>proxy.close(r));await new Promise(r=>backend.close(r));try{game.close();}catch{}rmSync(dir,{recursive:true,force:true});}
