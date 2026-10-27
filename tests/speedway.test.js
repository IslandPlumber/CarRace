import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {makeCircuit,makeSpeedway,trackPoint,trackFrame,circuitLength} from '../track.js';
import {simulateLiveRace,raceFinishedAt,publicLiveRace} from '../server/race-simulation.js';
import {ACTOR_IDS,validateRace} from '../race-core.js';
import {Game} from '../server/game.js';
const entrants=ACTOR_IDS.map(car=>({car,userId:car==='candy'?'human':null}));
const dot=(a,b)=>a.reduce((sum,x,i)=>sum+x*b[i],0);
test('speedway is roughly six times longer with flat apron and the specified 24-degree banking',()=>{
 const t=makeSpeedway();assert.ok(t.length/makeCircuit().length>5.8);assert.ok(t.length/1609.344>1.5&&t.length/1609.344<1.55);
 const turnDistance=t.straight+Math.PI*t.radius/4-t.startOffset,inside=trackPoint(t,turnDistance,-12),outside=trackPoint(t,turnDistance,12);
 assert.ok(Math.abs((outside.y-inside.y)/24-Math.tan(24*Math.PI/180))<1e-9);assert.equal(inside.y,0);assert.equal(trackPoint(t,turnDistance,-20).y,0);assert.equal(trackPoint(t,turnDistance,-20).bank,0);
 assert.ok(Math.abs(trackPoint(t,0).bank-4*Math.PI/180)<1e-9);
 for(const offset of[-12,-7.2,0,7.2,12]){const a=trackFrame(t,0,offset),b=trackFrame(t,circuitLength(t),offset);assert.ok(Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)<1e-8);assert.ok(Math.hypot(...a.up.map((x,i)=>x-b.up[i]))<1e-8);}
});
test('road frames stay orthonormal and smooth across all bank transitions and four turns',()=>{
 const t=makeSpeedway();let previous;
 for(let d=0;d<t.length;d+=.5){for(const offset of[-7.2,0,7.2]){const f=trackFrame(t,d,offset);for(const v of[f.forward,f.up,f.right])assert.ok(Math.abs(Math.hypot(...v)-1)<1e-9);assert.ok(Math.abs(dot(f.forward,f.up))<1e-9);assert.ok(Math.abs(dot(f.right,f.up))<1e-9);assert.ok(f.up[1]>.90);assert.ok(Number.isFinite(f.y));}
  const f=trackFrame(t,d,7.2);if(previous){assert.ok(Math.hypot(f.x-previous.x,f.y-previous.y,f.z-previous.z)<.65);assert.ok(dot(previous.up,f.up)>.999);}previous=f;
 }
});
test('legacy circuits stay flat; malformed banking is rejected before playback',()=>{
 const legacy=makeCircuit();for(let d=0;d<legacy.length;d+=3){const f=trackFrame(legacy,d,5);assert.equal(f.y,0);assert.equal(f.bank,0);assert.ok(Math.hypot(f.up[0],f.up[1]-1,f.up[2])<1e-12);}
 for(const change of[b=>b.turnDegrees=45,b=>b.width=5,b=>b.transition=0,b=>b.apron=-1,b=>b.straightDegrees=30]){const track=makeSpeedway();change(track.banking);assert.throws(()=>simulateLiveRace('invalid-banking',{entrants,track}),/bank/);}
});
test('larger banked races retain exact causal history, power inputs and measured finish order',()=>{
 const track=makeSpeedway(),before=simulateLiveRace('banked-causal',{entrants,track,specials:true}),after=simulateLiveRace('banked-causal',{entrants,track,specials:true,activations:[{actor:'candy',time:25}]});
 assert.equal(validateRace(after),after);assert.deepEqual(after.track,track);assert.deepEqual(publicLiveRace(before,24.9),publicLiveRace(after,24.9));assert.equal(after.outcome.length,7);assert.ok(raceFinishedAt(after)<after.duration);
 assert.ok(after.events.some(e=>e.actor==='candy'));
});
test('new track freezes at betting open and old in-flight races keep their course after an upgrade',t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'carrace-track-upgrade-')),file=path.join(dir,'game.sqlite');let now=100000;const options={clock:()=>now,bettingMs:1000};let game=new Game(file,options);t.after(()=>{try{game.close();}catch{}rmSync(dir,{recursive:true,force:true});});
 const user=game.register('TrackUpgrade','track-test-password').user,code=game.create(user.id),oldId=game.start(user.id,code);now=game.latest(code).starts+15000;game.tick();const oldBefore=JSON.parse(game.latest(code).definition);game.close();
 game=new Game(file,{...options,track:makeSpeedway()});assert.equal(game.profile(user.id).coins,1000);game.power(user.id,code,oldId,'old-course-power',1);const oldAfter=JSON.parse(game.latest(code).definition);assert.deepEqual(oldAfter.track,oldBefore.track);assert.equal(oldAfter.track.banking,undefined);assert.deepEqual(publicLiveRace(oldBefore,14),publicLiveRace(oldAfter,14));
 now=game.latest(code).starts+(raceFinishedAt(oldAfter)+1)*1000;game.tick();const id=game.start(user.id,code),frozen=game.room(user.id,code).race.track;assert.equal(frozen.profile,'speedway-v1');assert.equal(game.room(user.id,code).race.definition,null);game.close();
 game=new Game(file,{...options,track:makeSpeedway({radius:180})});now=game.latest(code).starts+20000;game.tick();assert.deepEqual(JSON.parse(game.latest(code).definition).track,frozen);assert.equal(game.latest(code).id,id);game.power(user.id,code,id,'new-course-power',1);assert.deepEqual(JSON.parse(game.latest(code).definition).track,frozen);
});
test('upgrading an old database during betting creates only the additive track table and keeps that pending round short',t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'carrace-pending-track-')),file=path.join(dir,'game.sqlite');let now=100000;const options={clock:()=>now,bettingMs:30000};let game=new Game(file,options);t.after(()=>{try{game.close();}catch{}rmSync(dir,{recursive:true,force:true});});
 const u=game.register('PendingDriver','pending-race-password').user,code=game.create(u.id),id=game.start(u.id,code);game.bet(u.id,code,'candy',25,'show');const profile=game.profile(u.id);game.db.exec('DROP TABLE race_tracks');game.close();
 game=new Game(file,{...options,track:makeSpeedway()});assert.deepEqual(game.profile(u.id),profile);const pending=game.room(u.id,code).race;assert.equal(pending.id,id);assert.equal(pending.phase,'betting');assert.equal(pending.track.banking,undefined);assert.equal(pending.bets[0].stake,25);now=pending.starts+10000;game.tick();assert.deepEqual(game.room(u.id,code).race.definition.track,makeCircuit());
});
