// Legacy v7 compatibility fixture; current paid specials are covered by the special-powers checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Game,RULES} from './game.js';
import {createServer} from './http.js';
import {sampleRace} from '../race-core.js';
import {raceFinishedAt} from './race-simulation.js';

function fixture(t){
  const folder=mkdtempSync(path.join(tmpdir(),'carrace-live-'));
  let now=100000;
  const file=path.join(folder,'game.sqlite'),clock=()=>now;
  const game=new Game(file,{specials:false,clock,bettingMs:1000,duration:64});
  t.after(()=>{try{game.close();}catch{}rmSync(folder,{recursive:true,force:true});});
  return {game,file,clock,setTime:value=>now=value,advance:n=>now+=n};
}
const register=(game,name)=>game.register(name,'live-test-password');
const definition=(game,code)=>JSON.parse(game.latest(code).definition);

test('manual controls enforce membership, frozen charges, gates, cooldown and idempotent retries',t=>{
  const {game:g,setTime,advance}=fixture(t),a=register(g,'ManualA'),b=register(g,'ManualB'),observer=register(g,'Observer');
  g.run('INSERT INTO player_upgrades VALUES(?,?,?)',a.user.id,'powerReserve',5);
  const code=g.create(a.user.id);g.join(b.user.id,code,'prism');
  const raceId=g.start(a.user.id,code),starts=g.latest(code).starts;
  // Joining after entries were frozen permits watching, never control of a CPU.
  g.join(observer.user.id,code,'seven');
  assert.throws(()=>g.power(a.user.id,code,raceId,'before-bets'),/Wait for the race/);
  advance(1001);g.tick();
  assert.equal(g.room(a.user.id,code).race.power.reason,'gates');
  assert.throws(()=>g.power(a.user.id,code,raceId,'before-gates'),/starting gate/);
  setTime(starts+20000);
  assert.throws(()=>g.power(observer.user.id,code,raceId,'spectator-1'),/watching/);
  assert.throws(()=>g.power(a.user.id,'ABCDEF',raceId,'wrong-room'),/Join this room/);
  assert.throws(()=>g.power(a.user.id,code,'old-race','wrong-race'),/race has changed/);
  assert.throws(()=>g.power(a.user.id,code,raceId,''),/Refresh/);
  const first=g.power(a.user.id,code,raceId,'manual-charge-one');
  assert.equal(first.charge,1);assert.ok(first.time>=20);
  const frozen=definition(g,code),status=g.room(a.user.id,code).race.power;
  assert.equal(status.actor,'candy');assert.equal(status.charges,2);assert.equal(status.used,1);assert.equal(status.remaining,1);
  assert.equal(status.reason,'cooldown');assert.equal(g.latest(code).phase,'racing');
  assert.throws(()=>g.power(a.user.id,code,raceId,'too-soon-reserve'),/still active/);
  assert.deepEqual(g.power(a.user.id,code,raceId,'manual-charge-one'),{...first,duplicate:true});
  assert.deepEqual(definition(g,code),frozen);
  assert.equal(g.one('SELECT COUNT(*) AS n FROM race_power_uses').n,1);
  assert.throws(()=>g.power(b.user.id,code,raceId,'manual-charge-one'),/already used/);
  setTime(Math.ceil(status.readyAt)+1);
  assert.equal(g.room(a.user.id,code).race.power.available,true);
  assert.equal(g.power(a.user.id,code,raceId,'manual-charge-two').charge,2);
  assert.equal(g.room(a.user.id,code).race.power.reason,'spent');
  assert.throws(()=>g.power(a.user.id,code,raceId,'third-charge-nope'),/every ability charge/);
  assert.equal(g.room(a.user.id,code).race.revision,2);
  assert.deepEqual(definition(g,code).events.filter(e=>e.actor==='candy').map(e=>e.charge),[1,2]);
  assert.equal(g.profile(a.user.id).coins,1000,'abilities do not silently charge coins');
});

test('a human move during the race changes the winner without changing prior motion, then pays the changed result once after restart',t=>{
  const {game:g,file,clock,setTime}=fixture(t),a=register(g,'WinnerChange');
  const code=g.create(a.user.id),raceId=g.start(a.user.id,code),starts=g.latest(code).starts;
  g.run('UPDATE live_races SET seed=? WHERE race_id=?','manual-car-flip-23',raceId);
  g.bet(a.user.id,code,'candy',50,'win');
  setTime(starts+35000);g.tick();
  const before=definition(g,code),publicBefore=g.room(a.user.id,code).race.definition;
  assert.equal(before.outcome[0],'junior');assert.deepEqual(publicBefore.outcome,[]);assert.equal(publicBefore.seed,'live');
  g.power(a.user.id,code,raceId,'winner-flip-now');
  const after=definition(g,code);
  assert.equal(after.outcome[0],'candy','the actual simulated crossing order must change');
  for(let time=0;time<=35;time+=.25){
    const a=sampleRace(before,time),b=sampleRace(after,time);
    assert.deepEqual(a.runners.map(r=>r.distance),b.runners.map(r=>r.distance),`past motion changed at ${time}`);
  }
  assert.deepEqual(g.room(a.user.id,code).race.definition.cast,publicBefore.cast,'already-published progress is immutable');
  const live=g.room(a.user.id,code).race;
  assert.equal(live.power.used,1);assert.equal(live.revision,1);
  const restored=new Game(file,{clock});
  try{
    assert.deepEqual(restored.room(a.user.id,code).race,live);
    assert.deepEqual(JSON.parse(restored.latest(code).definition),after);
    setTime(starts+(raceFinishedAt(after)+1)*1000);restored.tick();
    const result=restored.room(a.user.id,code).race;
    assert.equal(result.phase,'results');assert.equal(result.results[0].car,'candy');
    assert.equal(result.definition.completed,true);assert.equal(result.definition.seed,'live');
    assert.deepEqual(result.definition.outcome,after.outcome);
    assert.equal(result.bets[0].payout,200);
    assert.equal(restored.profile(a.user.id).coins,1000-50+RULES.prizes[0]+200);
    const saved=restored.profile(a.user.id),ledger=restored.ledger(a.user.id);
    restored.tick();assert.deepEqual(restored.profile(a.user.id),saved);assert.deepEqual(restored.ledger(a.user.id),ledger);
    assert.equal(restored.power(a.user.id,code,raceId,'winner-flip-now').duplicate,true,'a lost response can be retried after results');
    assert.throws(()=>restored.power(a.user.id,code,raceId,'late-new-charge'),/finished/);
  }finally{restored.close();}
});

test('all clients receive the same causal prefix without a seed, future events, progress or finish order',t=>{
  const {game:g,setTime}=fixture(t),a=register(g,'SameRaceA'),b=register(g,'SameRaceB');
  const code=g.create(a.user.id);g.join(b.user.id,code,'prism');const raceId=g.start(a.user.id,code),starts=g.latest(code).starts;
  setTime(starts+19000);g.tick();g.power(a.user.id,code,raceId,'causal-cast-one');
  setTime(starts+20000);
  const left=g.room(a.user.id,code).race,right=g.room(b.user.id,code).race;
  assert.deepEqual(left.definition,right.definition);assert.equal(left.definition.live,true);assert.deepEqual(left.definition.outcome,[]);
  assert.equal(left.definition.seed,'live');assert.equal(JSON.stringify(left).includes(g.one('SELECT seed FROM live_races WHERE race_id=?',raceId).seed),false);
  for(const runner of left.definition.cast){
    assert.ok(runner.progress.every(p=>p.time<=left.definition.availableTime));
    assert.ok(runner.moments.every(m=>m.time<=left.definition.availableTime));
  }
  assert.ok(left.definition.events.every(e=>e.time<=left.definition.availableTime));
  assert.equal(left.power.used,1);assert.equal(right.power.used,0);
  assert.equal(g.history(a.user.id)[0].ends,left.ends,'active history uses the fixed public horizon, never the projected finish');
  assert.notEqual(g.history(a.user.id)[0].ends,g.latest(code).ends);
  assert.ok(left.definition.events.some(e=>e.actor==='candy'));
  assert.equal(definition(g,code).events.filter(e=>e.actor==='prism').length,0,'other human drivers never fire automatically');
  assert.equal(definition(g,code).events.filter(e=>e.actor!=='candy').length,5,'CPU drivers still use their own abilities');
});

test('two drivers using a move in the same server step retain both inputs and every earlier position',t=>{
  const {game:g,setTime}=fixture(t),a=register(g,'TogetherA'),b=register(g,'TogetherB');
  const code=g.create(a.user.id);g.join(b.user.id,code,'prism');const raceId=g.start(a.user.id,code),starts=g.latest(code).starts;
  setTime(starts+25000);g.tick();const before=definition(g,code);
  const first=g.power(a.user.id,code,raceId,'same-step-first'),second=g.power(b.user.id,code,raceId,'same-step-second');
  assert.equal(first.time,second.time);
  const after=definition(g,code);
  for(let time=0;time<=25;time+=.25)assert.deepEqual(sampleRace(before,time).runners.map(r=>r.distance),sampleRace(after,time).runners.map(r=>r.distance));
  assert.equal(g.powerUses(raceId).length,2);assert.equal(g.room(a.user.id,code).race.revision,2);
  assert.equal(after.events.filter(e=>['candy','prism'].includes(e.actor)).length,2);
  setTime(starts+(first.time+.5)*1000);
  assert.deepEqual(g.room(a.user.id,code).race.definition,g.room(b.user.id,code).race.definition);
});

test('a click just before a car crosses cannot schedule an ability after its finish',t=>{
  const {game:g,setTime}=fixture(t),a=register(g,'PhotoFinish');
  const code=g.create(a.user.id),raceId=g.start(a.user.id,code),starts=g.latest(code).starts;
  g.run('UPDATE live_races SET seed=? WHERE race_id=?','manual-flip-11',raceId);
  setTime(starts+10000);g.tick();
  const def=definition(g,code),runner=def.cast.find(r=>r.id==='candy'),finish=runner.progress.find(p=>p.distance>=def.track.length).time;
  setTime(starts+(finish-.000001)*1000);
  assert.throws(()=>g.power(a.user.id,code,raceId,'photo-finish-key'),/reached the finish/);
  assert.equal(g.powerUses(raceId).length,0);
  assert.deepEqual(definition(g,code),def);
});

test('earlier pending races keep their automatic engine and cannot be rewritten by a live ability',t=>{
  const {game:g,setTime}=fixture(t),a=register(g,'OldPending');
  const code=g.create(a.user.id),raceId=g.start(a.user.id,code),starts=g.latest(code).starts;
  g.run('DELETE FROM live_races WHERE race_id=?',raceId);
  setTime(starts+20000);g.tick();
  const before=g.latest(code).definition;
  assert.equal(g.room(a.user.id,code).race.power.reason,'legacy');
  assert.throws(()=>g.power(a.user.id,code,raceId,'old-race-input'),/earlier automatic/);
  assert.equal(g.latest(code).definition,before);
});

test('HTTP power endpoint authenticates the driver, ignores forged actor/time, returns fresh charge state, and retries safely',async t=>{
  const {game:g,setTime}=fixture(t),a=register(g,'HTTPManual'),b=register(g,'HTTPOutsider');
  const code=g.create(a.user.id),raceId=g.start(a.user.id,code),starts=g.latest(code).starts;
  setTime(starts+20000);g.tick();
  const server=createServer(g);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const endpoint=`http://127.0.0.1:${server.address().port}/api/rooms/${code}/power`;
  const post=(token,body)=>fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
  assert.equal((await post(null,{raceId,requestId:'no-auth-key'})).status,401);
  assert.equal((await post(b.token,{raceId,requestId:'outsider-key'})).status,403);
  const first=await post(a.token,{raceId,requestId:'http-live-key',actor:'ironhart',time:0,charge:99});
  assert.equal(first.status,200);
  const body=await first.json();assert.equal(body.room.race.power.actor,'candy');assert.equal(body.room.race.power.used,1);
  assert.equal(body.room.race.revision,1);assert.equal(body.room.race.definition.seed,'live');
  const uses=g.powerUses(raceId);assert.equal(uses.length,1);assert.equal(uses[0].actor,'candy');assert.ok(uses[0].time>20);
  assert.equal((await post(a.token,{raceId,requestId:'http-live-key'})).status,200);
  assert.equal(g.powerUses(raceId).length,1);
  const exhausted=await post(a.token,{raceId,requestId:'another-key'});
  assert.equal(exhausted.status,409);assert.match((await exhausted.json()).error,/every ability charge/);
});
