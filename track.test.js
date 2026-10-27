import test from 'node:test';import assert from 'node:assert/strict';
import {makeCircuit,trackPoint,circuitLength,raceSection} from './track.js';
import {generateRace,sampleRace,validateRace} from './race-core.js';
const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
test('four-turn course is closed with continuous tangents at every join',()=>{
 const t=makeCircuit(),L=circuitLength(t),a=Math.PI*t.radius/2;
 const joins=[0,t.straight,t.straight+a,t.straight+a+t.shortStraight,t.straight+2*a+t.shortStraight,2*t.straight+2*a+t.shortStraight,2*t.straight+3*a+t.shortStraight,2*t.straight+3*a+2*t.shortStraight,L];
 assert.ok(dist(trackPoint(t,0),trackPoint(t,L))<1e-9);
 for(const s of joins){const x=trackPoint(t,s-t.startOffset-1e-4),y=trackPoint(t,s-t.startOffset+1e-4);assert.ok(dist(x,y)<.001);assert.ok(Math.abs(Math.sin(x.heading-y.heading))<.001);}
});
test('all four corners are visited and fixed lane offsets stay distinct throughout',()=>{
 const t=makeCircuit(),turns=new Set();for(let d=0;d<t.length;d+=.5){const center=trackPoint(t,d),inside=trackPoint(t,d,-7.2),outside=trackPoint(t,d,7.2);if(center.turn)turns.add(center.turn);assert.ok(Math.abs(dist(inside,outside)-14.4)<1e-8);assert.ok(Number.isFinite(center.heading));}assert.deepEqual([...turns].sort(),[1,2,3,4]);
});
test('circuit races wait at gates, traverse every corner, reach home, and finish as declared',()=>{
 for(let seed=0;seed<100;seed++){
 const race=generateRace(seed);assert.equal(race.duration,64);assert.equal(race.track.type,'circuit');
 assert.ok(sampleRace(race,2.9).runners.every(r=>r.distance===0));
 const turns=new Set();for(let time=3;time<race.duration;time+=.2){const state=sampleRace(race,time);for(const r of state.runners){if(r.turn)turns.add(r.turn);assert.ok(Number.isFinite(r.x)&&Number.isFinite(r.z));}}
 assert.deepEqual([...turns].sort(),[1,2,3,4]);assert.deepEqual(sampleRace(race,race.duration).standings,race.outcome);
 assert.equal(raceSection(race,race.track.length-20),'HOME STRETCH');assert.equal(raceSection(race,race.track.length),'FINISH');
 }
});
test('inconsistent dimensions, narrow radii and malformed lap geometry are rejected',()=>{
 for(const change of [r=>r.track.length++,r=>r.track.radius=2,r=>r.track.laps=0,r=>r.track.startOffset=-1]){const r=generateRace(1);change(r);assert.throws(()=>validateRace(r));}
});
