import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Game} from './game.js';
import {ACTOR_IDS,validateRace,sampleRace} from '../race-core.js';
import {simulateLiveRace,nextLiveActivationTime,raceFinishedAt,publicLiveRace} from './race-simulation.js';
import {specialPowerCost} from '../powers.js';
import {roundFromRoom} from '../bet-slips.js';
import {createServer} from './http.js';
function fixture(t){const dir=mkdtempSync(path.join(os.tmpdir(),'carrace-special-'));let now=100000;const file=path.join(dir,'game.sqlite'),clock=()=>now,g=new Game(file,{clock,bettingMs:1000});t.after(()=>{g.close();rmSync(dir,{recursive:true,force:true});});const u=g.register('SpecialPlayer','local-fixture-password').user,code=g.create(u.id);return {g,u,code,file,clock,set:n=>now=n};}
const finish=(r,id)=>r.cast.find(h=>h.id===id).progress.find(p=>p.distance>=r.track.length).time;

test('paid specials freeze their price, require clear client consent, charge once and allow exactly one use',t=>{
 const {g,u,code,set}=fixture(t);g.run('INSERT INTO player_upgrades VALUES(?,?,?)',u.id,'powerReserve',5);
 const id=g.start(u.id,code),starts=g.latest(code).starts;assert.equal(g.room(u.id,code).race.power.cost,50);
 assert.throws(()=>g.power(u.id,code,id,'early-special',1),/Wait for the race/);assert.equal(g.profile(u.id).coins,1000);
 set(starts+20000);g.tick();assert.throws(()=>g.power(u.id,code,id,'old-client-request'),/Refresh the game/);
 const first=g.power(u.id,code,id,'paid-special-one',1);assert.equal(first.charge,1);assert.equal(g.profile(u.id).coins,950);
 const state=g.room(u.id,code).race.power;assert.equal(state.charges,1);assert.equal(state.used,1);assert.equal(state.remaining,0);assert.equal(state.paid,50);
 assert.equal(g.power(u.id,code,id,'paid-special-one').duplicate,true);assert.equal(g.profile(u.id).coins,950);
 set(starts+35000);assert.throws(()=>g.power(u.id,code,id,'second-special-no',1),/every ability charge/);assert.equal(g.powerUses(id).length,1);
 assert.equal(g.all('SELECT * FROM ledger WHERE id=?',`power:${id}:${u.id}`).length,1);
});

test('insufficient coins, invalid timing and failed launches never charge or consume the one use',t=>{
 const {g,u,code,set}=fixture(t);g.credit(u.id,-950,'Local fixture',null);const id=g.start(u.id,code),starts=g.latest(code).starts;
 set(starts+20000);g.tick();assert.equal(g.room(u.id,code).race.power.reason,'coins');
 assert.throws(()=>g.power(u.id,code,id,'cannot-afford',1),/75 coins/);assert.equal(g.profile(u.id).coins,50);assert.equal(g.powerUses(id).length,0);assert.equal(g.powerSpent(u.id,id),0);
});

test('paid action, balance, fee in slips and upgraded movement survive restart and settle once',t=>{
 const {g,u,code,file,clock,set}=fixture(t),id=g.start(u.id,code),starts=g.latest(code).starts;
 g.bet(u.id,code,'candy',50,'show');set(starts+25000);g.tick();const before=JSON.parse(g.latest(code).definition);
 g.power(u.id,code,id,'restart-paid-use',1);const after=JSON.parse(g.latest(code).definition);assert.equal(after.simulation.model,'skills-v8-specials');
 for(let time=0;time<=25;time+=.25)assert.deepEqual(sampleRace(before,time).runners.map(r=>r.distance),sampleRace(after,time).runners.map(r=>r.distance));
 const restored=new Game(file,{clock});try{
  assert.equal(restored.profile(u.id).coins,875);assert.equal(restored.room(u.id,code).race.power.used,1);assert.equal(restored.power(u.id,code,id,'restart-paid-use').duplicate,true);
  assert.deepEqual(JSON.parse(restored.latest(code).definition),after);set(starts+(raceFinishedAt(after)+1)*1000);restored.tick();
  const room=restored.room(u.id,code),profile=restored.profile(u.id),own=room.race.results.find(r=>r.userId===u.id),returns=room.race.bets.reduce((n,b)=>n+b.payout,0);
  assert.equal(profile.coins,1000-50-75+own.prize+returns);assert.equal(restored.history(u.id)[0].powerSpent,75);assert.equal(room.race.powerSpent,75);
  assert.equal(roundFromRoom(room,profile).netCoins,profile.coins-1000);assert.equal(restored.history(u.id)[0].netCoins,profile.coins-1000);
  const saved=restored.profile(u.id);restored.tick();assert.deepEqual(restored.profile(u.id),saved);
 }finally{restored.close();}
});

test('power budget keeps every purchased rank valuable and prices stay frozen at betting open',t=>{
 assert.deepEqual([0,1,2,3,4,5].map(powerReserve=>specialPowerCost({powerReserve})),[75,70,65,60,55,50]);
 const {g,u,code,set}=fixture(t),id=g.start(u.id,code),starts=g.latest(code).starts;
 g.run('INSERT INTO player_upgrades VALUES(?,?,?)',u.id,'powerReserve',5);set(starts+20000);g.tick();assert.equal(g.room(u.id,code).race.power.cost,75);g.power(u.id,code,id,'frozen-price',1);assert.equal(g.profile(u.id).coins,925);
});

test('old in-flight v7 rounds retain their free reserve and their original saved physics',t=>{
 const {g,u,code,file,clock,set}=fixture(t);g.run('INSERT INTO player_upgrades VALUES(?,?,?)',u.id,'powerReserve',5);
 const id=g.start(u.id,code),starts=g.latest(code).starts;g.run('DELETE FROM race_power_rules WHERE race_id=?',id);set(starts+20000);g.tick();
 assert.equal(JSON.parse(g.latest(code).definition).simulation.model,'skills-v7-live');assert.equal(g.room(u.id,code).race.power.charges,2);
 g.power(u.id,code,id,'legacy-first');set(starts+30000);g.power(u.id,code,id,'legacy-second');assert.equal(g.profile(u.id).coins,1000);
 const saved=g.latest(code).definition,restored=new Game(file,{clock});try{assert.equal(restored.latest(code).definition,saved);assert.equal(restored.room(u.id,code).race.power.used,2);}finally{restored.close();}
});

test('each new special changes actual movement much more than the old power under the same race-day form',()=>{
 const entrants=ACTOR_IDS.map(car=>({car,userId:car}));const gains={};
 for(const actor of ACTOR_IDS){let gain=0;for(let seed=0;seed<20;seed++){
  const base=simulateLiveRace(`big-${seed}`,{entrants}),at=nextLiveActivationTime(base,25),activations=[{actor,time:at}];
  const old=simulateLiveRace(`big-${seed}`,{entrants,activations}),big=simulateLiveRace(`big-${seed}`,{entrants,activations,specials:true});
  gain+=finish(old,actor)-finish(big,actor);assert.equal(big.events.find(e=>e.actor===actor).spectacle,true);
 }gains[actor]=gain/20;assert.ok(gains[actor]>.5,`${actor}: only ${gains[actor]} seconds extra effect`);}
 console.log('Mean extra finish-time gain from the stronger single special:',gains);
});

test('strong specials keep the clock and history fixed, obey one use and finish extreme fields',()=>{
 const entrants=ACTOR_IDS.map(car=>({car,userId:car,upgrades:{powerReserve:5,powerDuration:10,powerPotency:10}}));
 for(const duration of [2,10,64,120])for(let seed=0;seed<12;seed++){
  const before=simulateLiveRace(`special-stress-${seed}`,{entrants,duration,specials:true}),time=nextLiveActivationTime(before,before.startDelay+(duration-before.startDelay)*.3);
  const activations=ACTOR_IDS.map(actor=>({actor,time})),race=simulateLiveRace(`special-stress-${seed}`,{entrants,duration,activations,specials:true});
  assert.equal(race.events.length,7);assert.ok(race.events.every(e=>e.charges===1));assert.equal(validateRace(publicLiveRace(race,raceFinishedAt(race))).completed,true);
  assert.deepEqual(publicLiveRace(before,time-.001),publicLiveRace(race,time-.001));
  assert.throws(()=>simulateLiveRace('twice',{entrants,duration,specials:true,activations:[{actor:'candy',time},{actor:'candy',time}]}),/charges or cooldown/);
 }
});

test('leader attacks impose a substantially larger real finish-time loss',()=>{
 const entrants=ACTOR_IDS.map(car=>({car,userId:car}));let total=0,count=0;
 for(let seed=0;seed<25;seed++){
  const idle=simulateLiveRace(`leader-special-${seed}`,{entrants}),time=nextLiveActivationTime(idle,25),activations=[{actor:'prism',time}];
  const old=simulateLiveRace(`leader-special-${seed}`,{entrants,activations}),big=simulateLiveRace(`leader-special-${seed}`,{entrants,activations,specials:true});
  const target=big.events.find(e=>e.actor==='prism').targets[0];if(!target)continue;
  assert.equal(old.events.find(e=>e.actor==='prism').targets[0],target);total+=finish(big,target)-finish(old,target);count++;
 }
 assert.ok(count>=15);assert.ok(total/count>1.5);console.log('Mean additional victim delay from the new pan:',total/count);
});

test('HTTP requires the priced client version and ignores forged free prices and actors',async t=>{
 const {g,u,code,set}=fixture(t),session=g.session(u.id),id=g.start(u.id,code);set(g.latest(code).starts+20000);g.tick();
 const server=createServer(g);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const post=body=>fetch(`http://127.0.0.1:${server.address().port}/api/rooms/${code}/power`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.token},body:JSON.stringify({raceId:id,...body})});
 assert.equal((await post({requestId:'outdated-browser'})).status,409);assert.equal(g.profile(u.id).coins,1000);
 const first=await post({requestId:'priced-browser',policyVersion:1,cost:0,actor:'prism',time:0});assert.equal(first.status,200);const response=await first.json();assert.equal(response.user.coins,925);assert.equal(response.room.race.power.actor,'candy');assert.equal(response.room.race.power.paid,75);
 assert.equal((await post({requestId:'priced-browser',policyVersion:1,cost:0})).status,200);assert.equal(g.profile(u.id).coins,925);
 assert.equal((await post({requestId:'second-priced-power',policyVersion:1})).status,409);assert.equal(g.profile(u.id).coins,925);
});
