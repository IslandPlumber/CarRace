import test from 'node:test';
import assert from 'node:assert/strict';
import {RACERS} from '../roster.js';
import {ACTOR_IDS,validateRace} from '../race-core.js';
import {POWERS,SPECIAL_POWERS} from '../powers.js';
import {Game} from '../server/game.js';
import {simulateLiveRace,raceFinishedAt} from '../server/race-simulation.js';
test('stock-car roster, account selections, and simulation use the same seven fictional drivers',()=>{
 assert.deepEqual([...RACERS.map(r=>r.id)].sort(),[...ACTOR_IDS].sort());
 assert.equal(new Set(RACERS.map(r=>r.number)).size,7);
 assert.equal(new Set(RACERS.map(r=>r.name)).size,7);
 for(const r of RACERS){assert.ok(POWERS[r.id]);assert.ok(SPECIAL_POWERS[r.id]);assert.equal(r.power.name,POWERS[r.id].name);}
 const game=new Game(':memory:');try{const u=game.register('StockCarTest','test-password-car');for(const r of RACERS){assert.equal(game.car(u.user.id,r.id).car,r.id);}}finally{game.close();}
});
test('every stock car can activate its move and all cars finish with measured, validated results',()=>{
 for(const selected of RACERS){const entrants=RACERS.map(r=>({car:r.id,...(r.id===selected.id?{userId:'human-driver'}:{})}));
  const base=simulateLiveRace('stock-car-abilities',{entrants,duration:52,specials:true});
  const def=simulateLiveRace('stock-car-abilities',{entrants,duration:52,specials:true,activations:[{actor:selected.id,time:15}]});
  assert.equal(validateRace(def),def);assert.equal(def.cast.length,7);assert.equal(def.outcome.length,7);assert.ok(raceFinishedAt(def)<def.duration);
  const event=def.events.find(e=>e.actor===selected.id);assert.ok(event);assert.equal(event.power,POWERS[selected.id].effect);
  // A new human input must not rewrite already-driven history.
  for(const r of def.cast){const old=base.cast.find(a=>a.id===r.id);assert.deepEqual(r.progress.filter(p=>p.time<15),old.progress.filter(p=>p.time<15));}
 }
});
