import test from 'node:test';
import assert from 'node:assert/strict';
import {ACTOR_IDS,sampleRace,validateRace} from '../race-core.js';
import {simulateLiveRace,publicLiveRace,nextLiveActivationTime,raceFinishedAt,LIVE_POWER_COOLDOWN,LIVE_SIMULATION_VERSION} from './race-simulation.js';
const entrants=ACTOR_IDS.map(car=>({car,userId:car==='candy'?'human-candy':null}));
const clone=value=>JSON.parse(JSON.stringify(value));

test('human abilities require live input while CPU abilities still fire automatically',()=>{
 const idle=simulateLiveRace('manual-only',{entrants});
 assert.equal(idle.simulation.model,LIVE_SIMULATION_VERSION);
 assert.equal(idle.events.some(e=>e.actor==='candy'),false);
 assert.equal(idle.events.length,6);
 const at=nextLiveActivationTime(idle,25),used=simulateLiveRace('manual-only',{entrants,activations:[{actor:'candy',time:at}]});
 const event=used.events.find(e=>e.actor==='candy');
 assert.ok(Math.abs(event.time-at)<1e-8);assert.equal(event.charge,1);
 assert.equal(sampleRace(used,at-.00001).events.some(e=>e.actor==='candy'),false);
 assert.equal(sampleRace(used,at+.00001).events.some(e=>e.actor==='candy'),true);
 const everyone=simulateLiveRace('manual-only',{entrants:ACTOR_IDS.map(car=>({car,userId:car}))});
 assert.equal(everyone.events.length,0,'offline humans are never auto-fired');
});

test('a live human action changes the actual winner without changing any past motion',()=>{
 const before=simulateLiveRace(1,{entrants});
 const at=nextLiveActivationTime(before,25);
 const after=simulateLiveRace(1,{entrants,activations:[{actor:'candy',time:at}]});
 assert.equal(before.outcome[0],'prism');assert.equal(after.outcome[0],'candy');
 for(const t of [0,3,10,24.8,25,at-.000001]) {
  assert.deepEqual(publicLiveRace(before,t),publicLiveRace(after,t),`published history at ${t} is immutable`);
  const physical = race => sampleRace(race,t).runners.map(({finishTime,...r})=>r);
  assert.deepEqual(physical(before),physical(after),`physical history at ${t} is immutable`);
 }
 const oldCandy=before.cast.find(r=>r.id==='candy'),newCandy=after.cast.find(r=>r.id==='candy');
 assert.ok(sampleRace(after,at+2).runners.find(r=>r.id==='candy').distance>
   sampleRace(before,at+2).runners.find(r=>r.id==='candy').distance,'boost changes real distance');
 assert.notDeepEqual(newCandy.progress,oldCandy.progress);
 assert.deepEqual(simulateLiveRace(1,{entrants,activations:clone([{actor:'candy',time:at}])}),after,'replay of persisted actions is exact');
});

test('live responses expose only confirmed history and clamp playback to it',()=>{
 const full=simulateLiveRace('private-secret-seed',{entrants});
 for(const elapsed of [0,.0001,3,full.startDelay-.001,full.startDelay,12.345,25.3,40]) {
  const publicRace=publicLiveRace(full,elapsed,{id:'public-room-race',revision:3});
  assert.equal(publicRace.seed,'live');assert.equal(publicRace.id,'public-room-race');
  assert.equal(publicRace.live,true);assert.equal(publicRace.completed,false);assert.deepEqual(publicRace.outcome,[]);
  assert.ok(publicRace.availableTime<=elapsed+1e-8);
  assert.ok(publicRace.cast.every(r=>r.progress.every(p=>p.time<=publicRace.availableTime)));
  assert.ok(publicRace.cast.every(r=>r.progress.at(-1).time===publicRace.availableTime));
  assert.ok(publicRace.events.every(e=>e.time<=publicRace.availableTime));
  assert.ok(publicRace.cast.every(r=>(r.moments??[]).every(m=>m.time<=publicRace.availableTime&&m.end<=publicRace.availableTime)));
  assert.equal(JSON.stringify(publicRace).includes('private-secret-seed'),false);
  assert.equal(sampleRace(publicRace,9999).time,publicRace.availableTime);
  assert.equal(validateRace(clone(publicRace)).live,true);
 }
 const completedAt=raceFinishedAt(full),done=publicLiveRace(full,completedAt);
 assert.equal(done.completed,true);assert.equal(done.duration,completedAt);assert.equal(done.availableTime,completedAt);
 assert.deepEqual(done.outcome,full.outcome);assert.ok(sampleRace(done,completedAt).runners.every(r=>r.finished));
 assert.throws(()=>validateRace({...publicLiveRace(full,20),outcome:full.outcome}),/cannot expose an outcome/);
 assert.throws(()=>validateRace({...publicLiveRace(full,20),seed:'revealed'}),/private seed/);
});

test('manual reserve is finite, obeys cooldown and never silently consumes another driver input',()=>{
 const reserve=entrants.map(e=>({...e,...(e.car==='candy'?{upgrades:{powerReserve:5}}:{})}));
 const base=simulateLiveRace('reserve-inputs',{entrants:reserve});
 const first=nextLiveActivationTime(base,18),second=nextLiveActivationTime(base,first+LIVE_POWER_COOLDOWN);
 const actions=[{actor:'candy',time:first},{actor:'candy',time:second}];
 const race=simulateLiveRace('reserve-inputs',{entrants:reserve,activations:actions});
 assert.deepEqual(race.events.filter(e=>e.actor==='candy').map(e=>e.charge),[1,2]);
 assert.throws(()=>simulateLiveRace('reserve-inputs',{entrants:reserve,activations:[...actions,{actor:'candy',time:40}]}),/charges or cooldown/);
 assert.throws(()=>simulateLiveRace('reserve-inputs',{entrants:reserve,activations:[actions[0],{actor:'candy',time:first+1}]}),/charges or cooldown/);
 for(const activation of [{actor:'ironhart',time:20},{actor:'unknown',time:20},{actor:'candy',time:NaN},{actor:'candy',time:0}])
  assert.throws(()=>simulateLiveRace('bad',{entrants,activations:[activation]}),/Invalid live activation/);
});

test('late casts, short test rounds and upgraded fourteen-cast fields remain valid on a fixed clock',()=>{
 const powerful=ACTOR_IDS.map(car=>({car,userId:car,upgrades:{powerReserve:5,powerPotency:10,powerDuration:10,powerReach:10}}));
 for(const duration of [2,10,64,120]) for(let seed=0;seed<30;seed++) {
  const base=simulateLiveRace(`stress-${seed}`,{entrants:powerful,duration});
  const first=nextLiveActivationTime(base,base.startDelay+(duration-base.startDelay)*.3);
  const second=nextLiveActivationTime(base,first+LIVE_POWER_COOLDOWN+.1);
  const activations=powerful.flatMap(e=>[{actor:e.car,time:first},...(second<raceFinishedAt(base)-1?[{actor:e.car,time:second}]:[])]);
  const race=simulateLiveRace(`stress-${seed}`,{entrants:powerful,duration,activations});
  assert.equal(race.duration,base.duration);assert.equal(race.simulation.scale,base.simulation.scale);
  assert.equal(validateRace(race),race);assert.ok(raceFinishedAt(race)<race.duration);
  assert.equal(validateRace(publicLiveRace(race,raceFinishedAt(race))).completed,true);
 }
});


test('a cast immediately before its actor finishes remains valid in the completed public replay',()=>{
 for(const duration of [2,10,64,120]) for(const actor of ACTOR_IDS) for(let seed=0;seed<12;seed++) {
  const field=ACTOR_IDS.map(car=>({car,userId:car===actor?car:null,upgrades:car===actor?{powerReserve:5,powerDuration:10}:undefined}));
  const base=simulateLiveRace(`late-${seed}`,{entrants:field,duration});
  const runner=base.cast.find(r=>r.id===actor),cross=runner.progress.find(p=>p.distance>=base.track.length).time;
  const step=base.simulation.stepSeconds;
  const at=base.startDelay+Math.floor((cross-base.startDelay)/step-1e-8)*step;
  const actions=[{actor,time:at}];
  const race=simulateLiveRace(`late-${seed}`,{entrants:field,duration,activations:actions});
  assert.equal(race.events.filter(e=>e.actor===actor).length,1);
  const done=publicLiveRace(race,raceFinishedAt(race));
  assert.equal(validateRace(done),done);
  for(const e of done.events) {
   assert.ok(e.time+e.duration<=done.duration+1e-8);
   assert.ok(e.hitTime+e.hitDuration<=done.duration+1e-8);
  }
 }
});
