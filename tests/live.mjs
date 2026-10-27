import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
const base=(process.env.CARRACE_URL??'https://streakchat.app/carrace/').replace(/\/?$/,'/');
mkdirSync('review/live',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),a=await browser.newContext({viewport:{width:1440,height:1100}}),b=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),p=await a.newPage(),q=await b.newPage(),errors=[],outside=[];
const password='CarRace-verify-'+crypto.randomUUID(),stamp=Date.now().toString(36),nameA='CarCheckA_'+stamp,nameB='CarCheckB_'+stamp;
for(const page of [p,q]){page.on('pageerror',e=>errors.push(e.message));page.on('request',req=>{const u=new URL(req.url());if(u.origin===new URL(base).origin&&!u.pathname.startsWith(new URL(base).pathname))outside.push(u.pathname);});}
async function api(page,path,body){return page.evaluate(async({path,body})=>{const token=localStorage.getItem('carrace.session.v1');const r=await fetch(new URL('api'+path,location.href),{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});return{status:r.status,data:await r.json()};},{path,body});}
async function register(page,name,driver){await page.goto(base,{waitUntil:'networkidle'});await page.locator('#loading').waitFor({state:'hidden'});await page.getByRole('button',{name:'Choose '+driver}).click();await page.locator('#account').click();await page.locator('#username').fill(name);await page.locator('#password').fill(password);await page.locator('#auth-submit').click();await page.locator('#auth-dialog').waitFor({state:'hidden'});await page.locator('.room-code').waitFor();}
try{
 await register(p,nameA,'Duke Ironhart');await p.getByRole('button',{name:'Garage',exact:true}).click();await p.locator('[data-upgrade="stride"]').click();await p.waitForTimeout(600);assert.equal((await api(p,'/me')).data.user.upgrades.stride,1);
 // Create a verification-only room so real players can continue using the main room.
 const made=await api(p,'/rooms',{});assert.equal(made.status,200);const code=made.data.code;
 await register(q,nameB,'Rowdy Candy');const joined=await api(q,`/rooms/${code}/join`,{car:'candy'});assert.equal(joined.status,200);
 assert.equal((await api(p,`/rooms/${code}/start`,{})).status,200);
 for(const[page,car,kind,stake]of[[p,'ironhart','win',25],[q,'candy','show',50]])assert.equal((await api(page,`/rooms/${code}/bets`,{car,kind,stake})).status,200);
 const before=(await api(p,`/rooms/${code}`)).data.room;assert.equal(before.race.phase,'betting');assert.equal(before.race.definition,null);console.log('LIVE: two players registered; upgrade saved; private room joined; Win/Show bets placed. Waiting for the real server clock.');
 for(const page of[p,q])await page.getByRole('button',{name:'The circuit',exact:true}).click();
 await p.locator('#ability:not([disabled])').waitFor({timeout:55000});await q.locator('#ability:not([disabled])').waitFor({timeout:10000});
 await p.locator('#ability').click();await q.locator('#ability').click();await p.waitForTimeout(1200);
 const ar=(await api(p,`/rooms/${code}`)).data.room,br=(await api(q,`/rooms/${code}`)).data.room;
 assert.equal(ar.race.id,br.race.id);assert.equal(ar.race.power.used,1);assert.equal(br.race.power.used,1);assert.equal(ar.race.definition.seed,'live');assert.deepEqual(ar.race.definition.outcome,[]);
 assert.equal((await api(p,'/me')).data.user.coins,810);assert.equal((await api(q,'/me')).data.user.coins,875);
 await p.getByRole('button',{name:'Chase',exact:true}).click();await p.waitForTimeout(1200);await p.screenshot({path:'review/live/desktop-racing.png',fullPage:true});await q.screenshot({path:'review/live/mobile-racing.png',fullPage:true});console.log('LIVE: both signature abilities applied once, fees correct, shared official race verified.');
 let result;for(let i=0;i<110;i++){result=(await api(p,`/rooms/${code}`)).data.room;if(result.race.phase==='results')break;await p.waitForTimeout(1000);}assert.equal(result.race.phase,'results');
 const profiles=[];for(const[page,starting]of[[p,810],[q,875]]){const profile=(await api(page,'/me')).data.user,r=(await api(page,`/rooms/${code}`)).data.room.race,own=r.results.find(e=>e.userId===profile.id),ticket=r.bets[0];assert.equal(profile.coins,starting+own.prize+ticket.payout);const history=(await api(page,'/history?betsOnly=1')).data.history;assert.equal(history.length,1);assert.equal(history[0].bets.length,1);profiles.push({name:profile.username,coins:profile.coins,points:profile.points,place:own.place,prize:own.prize,ticketReturn:ticket.payout});}
 await p.getByRole('button',{name:'Race club',exact:true}).click();await p.waitForTimeout(900);await p.screenshot({path:'review/live/results.png',fullPage:true});await q.getByRole('button',{name:'Past bets',exact:true}).click();await q.locator('.history-card').waitFor();await q.screenshot({path:'review/live/mobile-history.png',fullPage:true});assert.equal(await q.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await p.reload({waitUntil:'networkidle'});await p.waitForTimeout(1100);assert.match(await p.locator('#account').textContent(),new RegExp(nameA));assert.equal((await api(p,'/me')).data.user.coins,profiles[0].coins);
 // Leave seats after the verification run. Retain legitimate test race history and balances.
 await api(p,`/rooms/${code}/leave`,{});await api(q,`/rooms/${code}/leave`,{});
 assert.deepEqual(errors,[]);assert.deepEqual(outside,[]);const report={passed:true,url:base,verifiedAt:new Date().toISOString(),room:code,race:result.race.id,profiles,browserErrors:errors,outsideCarRaceRequests:outside};writeFileSync('review/live/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
