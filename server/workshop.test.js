// Legacy v7 compatibility fixture; current paid specials are covered by the special-powers checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Game,RULES} from './game.js';
import {simulateRace} from './race-simulation.js';
import {UPGRADES,normalizeUpgrades,upgradeCost,masteryPace,finishPrize} from '../progression.js';
import {ACTOR_IDS,sampleRace,validateRace} from '../race-core.js';
import {finishTime} from '../tests/race-measures.js';
const field=upgrades=>ACTOR_IDS.map(car=>({car,...(car==='candy'?{upgrades}:{})}));
const run=(seed,upgrades={},powers=true)=>simulateRace(seed,{entrants:field(upgrades),powers});
const finish=race=>finishTime(race,race.cast.find(r=>r.id==='candy'));
function fixture(t){const folder=mkdtempSync(path.join(os.tmpdir(),'carrace-workshop-'));let now=100000;const file=path.join(folder,'game.sqlite'),clock=()=>now,g=new Game(file,{specials:false,clock,bettingMs:1000,duration:10});t.after(()=>{g.close();rmSync(folder,{recursive:true,force:true});});return {g,file,clock,advance:n=>now+=n};}

test('catalogue has 20 real paths, bounded prices and repeatable diminishing mastery',()=>{
 assert.equal(Object.keys(UPGRADES).length,20);assert.equal(Object.values(UPGRADES).filter(u=>u.max===null).length,1);
 for(const [kind,u]of Object.entries(UPGRADES)){assert.ok(upgradeCost(kind,1)>upgradeCost(kind,0));if(u.max!==null)assert.equal(upgradeCost(kind,u.max),null);}
 assert.ok(upgradeCost('stride',0,{trainingDiscount:10})<upgradeCost('stride',0));assert.equal(upgradeCost('trainingDiscount',0,{trainingDiscount:10}),100);
 assert.ok(masteryPace(1000)>masteryPace(100));assert.ok(masteryPace(100000)<.03);assert.ok(masteryPace(1001)-masteryPace(1000)<masteryPace(2)-masteryPace(1));
 assert.ok(upgradeCost('mastery',1000)>0);assert.equal(finishPrize(35,{prizeBonus:10}),49);assert.equal(finishPrize(25,{prizeBonus:3}),28);
 for(const levels of [{unknown:1},{stride:-1},{stride:11},{stride:1.5},{mastery:Infinity},[]])assert.throws(()=>normalizeUpgrades(levels));
});

test('workshop purchases debit exact server prices, reject stale requests and preserve original training',t=>{
 const {g}=fixture(t),user=g.register('Workshop','test-fixture-only').user;
 assert.deepEqual(user.upgrades,{});const before=g.one('SELECT * FROM users WHERE id=?',user.id);
 g.upgrade(user.id,'stride',0);assert.equal(g.profile(user.id).coins,910);assert.equal(g.profile(user.id).upgrades.stride,1);
 assert.throws(()=>g.upgrade(user.id,'stride',0),/level changed/);assert.equal(g.profile(user.id).coins,910);
 g.upgrade(user.id,'trainingDiscount',0);const cost=upgradeCost('stride',1,g.profile(user.id).upgrades);g.upgrade(user.id,'stride',1);assert.equal(g.profile(user.id).coins,810-cost);
 g.upgrade(user.id,'speed');assert.equal(g.profile(user.id).coins,810-cost-120);assert.equal(g.profile(user.id).speed,1);
 assert.equal(g.profile(user.id).focus,before.focus);assert.equal(RULES.maxLevel,5);
 const garage=g.profile(user.id);assert.throws(()=>g.upgrade(user.id,'constructor'),/Unknown/);assert.throws(()=>g.upgrade(user.id,'powerReserve',{}),/level changed/);assert.deepEqual(g.profile(user.id),garage);
 g.run('UPDATE users SET coins=0 WHERE id=?',user.id);assert.throws(()=>g.upgrade(user.id,'blinkers',0),/Not enough/);assert.equal(g.profile(user.id).upgrades.blinkers,undefined);
});

test('additive workshop table restores old accounts without rewriting their data',t=>{
 const {g,file,clock}=fixture(t),u=g.register('Returning','test-fixture-only').user;g.upgrade(u.id,'speed');
 const before=g.all('SELECT * FROM users');g.run('DROP TABLE player_upgrades');
 const restored=new Game(file,{clock});try{assert.deepEqual(restored.all('SELECT * FROM users'),before);assert.deepEqual(restored.profile(u.id).upgrades,{});restored.upgrade(u.id,'gatecraft',0);assert.equal(restored.profile(u.id).upgrades.gatecraft,1);}finally{restored.close();}
});

test('workshop levels freeze into a race and preserve all effects, tickets and awards on restart',t=>{
 const {g,file,clock,advance}=fixture(t),u=g.register('FrozenBuild','test-fixture-only').user;
 for(const kind of ['stride','prizeBonus','powerPotency'])g.upgrade(u.id,kind,0);
 const code=g.create(u.id);g.start(u.id,code);g.bet(u.id,code,'candy',50,'show');
 const frozen=JSON.parse(g.latest(code).entrants).find(e=>e.userId===u.id);assert.deepEqual(frozen.upgrades,g.profile(u.id).upgrades);
 for(const kind of Object.keys(UPGRADES))assert.throws(()=>g.upgrade(u.id,kind),/after this race/);
 advance(1001);g.tick();const definition=g.room(u.id,code).race.definition;
 assert.deepEqual(definition.cast.find(r=>r.id==='candy').upgrades,frozen.upgrades);
 const restored=new Game(file,{clock});try{
  assert.deepEqual(restored.room(u.id,code).race.definition,definition);advance(20000);restored.tick();
  const race=restored.room(u.id,code).race,own=race.results.find(r=>r.userId===u.id);
  assert.equal(own.prize,Math.floor(RULES.prizes[own.place-1]*1.04));assert.equal(own.points,RULES.points[own.place-1]);
  const profile=restored.profile(u.id),ledger=restored.ledger(u.id);restored.tick();assert.deepEqual(restored.profile(u.id),profile);assert.deepEqual(restored.ledger(u.id),ledger);
  assert.deepEqual(restored.history(u.id)[0].prize,own.prize);
 }finally{restored.close();}
});

test('every car training path changes real movement with the same race-day luck',()=>{
 const kinds=['gatecraft','stride','cornering','conditioning','finishing','drafting','balance','secondWind','tires','mastery'],gains={};
 for(const kind of kinds){let gain=0;for(let i=0;i<50;i++){const seed=`car-path-${i}`;gain+=finish(run(seed,{},false))-finish(run(seed,{[kind]:kind==='mastery'?100:10},false));}gains[kind]=gain/50;assert.ok(gains[kind]>.005,`${kind}: ${gains[kind]}`);}
 console.log('Mean finish gains by car path:',gains);
});

test('tack reduces actual attack losses and powers gain strength, duration, reach and discipline',()=>{
 const gains={};
 for(const kind of ['saddle','recovery','blinkers','powerPotency','powerDuration','powerDiscipline']){
  let gain=0;for(let i=0;i<100;i++){
   const seed=`power-path-${i}`,entries=upgrades=>ACTOR_IDS.map(car=>({car,...(car==='candy'?{speed:4,stamina:2,focus:1,upgrades}:{})}));
   gain+=finish(simulateRace(seed,{entrants:entries({})}))-finish(simulateRace(seed,{entrants:entries({[kind]:10})}));
  }gains[kind]=gain/100;assert.ok(gains[kind]>.005,`${kind}: ${gains[kind]}`);
 }
 const a=run('reach',{}),b=run('reach',{powerReach:10});assert.ok(b.events.find(e=>e.actor==='candy').time<a.events.find(e=>e.actor==='candy').time);
 console.log('Mean finish gains by tack/power path:',gains);
});

test('reserve charge unlocks a real second move; extreme complete builds still validate and finish',()=>{
 const race=run('reserve',{powerReserve:5}),moves=race.events.filter(e=>e.actor==='candy');assert.equal(moves.length,2);assert.equal(moves[1].charge,2);assert.ok(moves[1].time>moves[0].time);
 assert.ok(finish(race)<finish(run('reserve',{})));assert.equal(new Set(race.events.map(e=>e.id)).size,race.events.length);
 for(let i=0;i<70;i++){
  const full=Object.fromEntries(Object.entries(UPGRADES).map(([id,u])=>[id,u.max??1000]));
  const def=simulateRace(`complete-${i}`,{entrants:ACTOR_IDS.map(car=>({car,speed:5,stamina:5,focus:5,upgrades:full})),duration:i%2?64:10});
  assert.equal(validateRace(def),def);assert.deepEqual(sampleRace(def,def.duration).standings,def.outcome);assert.equal(def.events.length,14);
  for(const e of def.events)for(const end of Object.values(e.targetEnds))assert.ok(end<=def.duration&&end>=e.hitTime);
 }
});

test('all fully upgraded driver identities can still win competitive equal-build races',()=>{
 const upgrades=Object.fromEntries(Object.entries(UPGRADES).map(([id,u])=>[id,u.max??1000])),wins=Object.fromEntries(ACTOR_IDS.map(id=>[id,0]));
 for(let i=0;i<700;i++)wins[simulateRace(`equal-workshop-${i}`,{entrants:ACTOR_IDS.map(car=>({car,speed:5,stamina:5,focus:5,upgrades}))}).outcome[0]]++;
 for(const [id,n]of Object.entries(wins))assert.ok(n/700>.07&&n/700<.25,`${id}: ${n/7}%`);
 console.log('Equal complete workshop builds:',wins);
});
