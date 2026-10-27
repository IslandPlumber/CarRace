import test from 'node:test';
import assert from 'node:assert/strict';
import {LivePlayback,finishTimes} from '../playback.js';
import {simulateLiveRace,publicLiveRace,raceFinishedAt} from '../server/race-simulation.js';
import {makeSpeedway} from '../track.js';
import {RACERS} from '../roster.js';

const full=simulateLiveRace('buffered-speedway',{track:makeSpeedway(),specials:true,entrants:RACERS.map(r=>({car:r.id}))});
test('uneven live updates play continuously without seeking, rewinding, or predicting future movement',()=>{
 const playback=new LivePlayback(),delays=[.1,.65,.28,.4,.18,.8];
 let definition,next=0,previous,oldPrevious,oldStalls=0,stalls=0;
 for(let frame=0;frame<60*40;frame++){
  const elapsed=5+frame/60;
  if(elapsed>=next){definition=publicLiveRace(full,elapsed-delays[Math.floor(elapsed/1.3)%delays.length],{id:'live'});next=elapsed+1.3;}
  const time=playback.read({id:'live',starts:0,definition},elapsed*1000,elapsed*1000);
  const old=Math.max(0,Math.min(elapsed-1.05,definition.availableTime));
  assert.ok(time>=0&&time<=definition.availableTime);
  if(previous!==undefined){
   assert.ok(time>=previous,'an update must never rewind the cars');
   assert.ok(time-previous<=1.12/60+1e-8,'network arrivals must never jump the cars forward');
   if(time-previous<.001)stalls++;
   if(old-oldPrevious<.001)oldStalls++;
  }
  previous=time;oldPrevious=old;
 }
 assert.ok(oldStalls>500,'the fixture reproduces the old stop-and-jump playback');
 assert.equal(stalls,0,'buffered movement remains continuous under the same network jitter');
});

test('clock corrections, late packets, and a connection outage cannot teleport the field',()=>{
 const playback=new LivePlayback();let previous;
 for(let frame=0;frame<600;frame++){
  const elapsed=10+frame/60,head=frame<120?elapsed-.15:frame<360?12:elapsed-.15;
  const definition=publicLiveRace(full,head,{id:'late'});
  const serverTime=(elapsed+(frame>=420?-3:frame>=360?5:0))*1000;
  const time=playback.read({id:'late',starts:0,definition},serverTime,elapsed*1000);
  assert.ok(time<=playback.head);
  if(previous!==undefined){assert.ok(time>=previous);assert.ok(time-previous<=1.12/60+1e-8);}
  previous=time;
 }
 assert.ok(previous>12,'playback recovers when updates resume');
});

test('the final snapshot plays through the finish, while a new visitor sees settled results immediately',()=>{
 const playback=new LivePlayback(),end=raceFinishedAt(full),before=publicLiveRace(full,end-1,{id:'finish'}),complete=publicLiveRace(full,end+1,{id:'finish'});
 const race={id:'finish',starts:0,definition:before};
 let time=playback.read(race,(end-1)*1000,0);race.definition=complete;
 const first=playback.read(race,(end+1)*1000,16);
 assert.ok(first-time<.02,'settlement must not skip the last buffered seconds');
 for(let now=32;now<6000;now+=16)time=playback.read(race,(end+1)*1000+now,now);
 assert.equal(time,complete.availableTime);
 assert.equal(new LivePlayback().read(race,(end+1)*1000,0),complete.availableTime);
 const next={id:'next-race',starts:100000,definition:publicLiveRace(full,2,{id:'next-race'})};
 assert.ok(playback.read(next,102000,7000)<1,'a new race gets a fresh playback clock');
});

test('cached crossings preserve finish order and incomplete snapshots',()=>{
 const unfinished=publicLiveRace(full,10),cached=finishTimes(full);
 assert.equal(finishTimes(full),cached);
 assert.deepEqual([...cached].sort((a,b)=>a[1]-b[1]).map(([id])=>id),full.outcome);
 assert.ok([...finishTimes(unfinished).values()].every(time=>time===Infinity));
});
