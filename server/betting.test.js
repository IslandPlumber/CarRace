import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Game} from './game.js';
import {ACTOR_IDS} from '../race-core.js';
import {BET_TYPES,ticketReturn} from '../betting.js';
function fixture(t){
 const dir=mkdtempSync(path.join(tmpdir(),'carrace-bets-'));let now=100000;
 const db=path.join(dir,'game.sqlite'),clock=()=>now;
 const g=new Game(db,{clock,bettingMs:1000,duration:10});
 const a=g.register('Alice','test-password-123').user,code=g.create(a.id);g.start(a.id,code);
 t.after(()=>{g.close();rmSync(dir,{recursive:true,force:true})});
 return {g,a,code,db,clock,advance:n=>now+=n};
}
test('Win pays only first; Place pays first or second; Show pays any top-three finish',t=>{
 for(let finish=1;finish<=7;finish++){
  const {g,a,code}=fixture(t),r=g.latest(code);
  for(const kind of Object.keys(BET_TYPES))g.bet(a.id,code,'candy',51,kind);
  const order=ACTOR_IDS.filter(id=>id!=='candy');order.splice(finish-1,0,'candy');
  g.settle(r,{outcome:order});
  const tickets=g.room(a.id,code).race.bets;
  for(const b of tickets)assert.equal(b.payout,finish<=BET_TYPES[b.kind].places?ticketReturn(51,BET_TYPES[b.kind].units):0);
  assert.equal(g.profile(a.id).coins,1000-153+tickets.reduce((n,b)=>n+b.payout,0)+g.room(a.id,code).race.results.find(e=>e.userId===a.id).prize);
 }
});
test('one ticket of each type locks independently and duplicate or invalid bets never charge coins',t=>{
 const {g,a,code}=fixture(t);
 g.bet(a.id,code,'candy',50,'win');g.bet(a.id,code,'ironhart',50,'place');g.bet(a.id,code,'smoke',51,'show');
 const before=g.profile(a.id).coins;
 for(const kind of ['win','place','show'])assert.throws(()=>g.bet(a.id,code,'seven',50,kind),/already/);
 for(const kind of ['__proto__','fourth',null,{},1])assert.throws(()=>g.bet(a.id,code,'candy',50,kind),/Win, Place or Show/);
 assert.equal(g.profile(a.id).coins,before);assert.equal(g.raceBets(g.latest(code).id,a.id).length,3);
});
test('multiple types share the same bankroll and exact cutoff; fractional Show returns round down',t=>{
 const {g,a,code,advance}=fixture(t);
 g.bet(a.id,code,'candy',500,'win');g.bet(a.id,code,'candy',500,'place');
 assert.throws(()=>g.bet(a.id,code,'candy',10,'show'),/Not enough/);
 assert.equal(g.profile(a.id).coins,0);assert.equal(g.raceBets(g.latest(code).id,a.id).length,2);
 advance(1000);assert.throws(()=>g.bet(a.id,code,'candy',10,'show'),/closed/);
 assert.equal(ticketReturn(11,150),16);assert.equal(ticketReturn(51,150),76);
});
test('typed tickets and all payouts survive restart without duplicate credits or private-bet leakage',t=>{
 const {g,a,code,db,clock,advance}=fixture(t);
 const b=g.register('Bobby','test-password-123').user;g.car(b.id,'smoke');g.join(b.id,code);
 for(const kind of ['win','place','show'])g.bet(a.id,code,'candy',50,kind);
 assert.deepEqual(g.room(b.id,code).race.bets,[]);
 const pending=g.history(a.id)[0].bets;assert.equal(pending.length,3);assert.ok(pending.every(b=>b.payout===null&&b.place===null));
 const restored=new Game(db,{clock});
 try{
  assert.deepEqual(restored.history(a.id)[0].bets,pending);advance(20000);restored.tick();
  const after=restored.profile(a.id),history=restored.history(a.id);
  assert.equal(history[0].bets.length,3);assert.ok(history[0].bets.every(b=>b.payout!==null));
  restored.tick();g.tick();assert.deepEqual(restored.profile(a.id),after);assert.deepEqual(g.history(a.id),history);
 }finally{restored.close()}
});
test('legacy Win tickets remain unchanged and can coexist with new Place and Show tickets',t=>{
 const {g,a,code}=fixture(t),r=g.latest(code);
 g.run('INSERT INTO bets VALUES(?,?,?,?,?,NULL)','legacy-win',a.id,r.id,'candy',50);g.credit(a.id,-50,'Win bet',r.id);
 assert.throws(()=>g.bet(a.id,code,'candy',50,'win'),/already/);
 g.bet(a.id,code,'candy',50,'place');g.bet(a.id,code,'candy',50,'show');
 const order=['candy',...ACTOR_IDS.filter(h=>h!=='candy')];g.settle(r,{outcome:order});
 const legacy=g.one('SELECT * FROM bets WHERE id=?','legacy-win');assert.equal(legacy.payout,200);
 const tickets=g.history(a.id)[0].bets;assert.deepEqual(tickets.map(b=>[b.kind,b.payout]),[['win',200],['place',100],['show',75]]);
 const balance=g.profile(a.id).coins;g.settle(r,{outcome:order});assert.equal(g.profile(a.id).coins,balance);
 assert.deepEqual(g.one('SELECT * FROM bets WHERE id=?','legacy-win'),legacy);
});

test('Past bets excludes no-ticket races before the limit, retaining legacy, typed and spectator tickets',async t=>{
 const {g,a,code,advance}=fixture(t),first=g.latest(code).id;
 g.bet(a.id,code,'candy',10,'place');g.settle(g.latest(code),{outcome:ACTOR_IDS});advance(1);
 const legacy=g.start(a.id,code);g.credit(a.id,-10,'Legacy Win bet',legacy);g.run('INSERT INTO bets VALUES(?,?,?,?,?,NULL)','legacy-history-ticket',a.id,legacy,'ironhart',10);g.settle(g.latest(code),{outcome:ACTOR_IDS});advance(1);
 for(let i=0;i<55;i++){g.start(a.id,code);g.settle(g.latest(code),{outcome:ACTOR_IDS});advance(1);}
 assert.equal(g.history(a.id).length,50);assert.ok(g.history(a.id).every(r=>!r.bets.length));
 const only=g.history(a.id,{betsOnly:true});assert.deepEqual(only.map(r=>r.id),[legacy,first]);assert.deepEqual(only.map(r=>r.bets[0].kind),['win','place']);
 const other=g.register('OtherBettor','test-password-123'),otherRoom=g.create(other.user.id);g.start(other.user.id,otherRoom);g.bet(other.user.id,otherRoom,'ironhart',10,'show');g.join(a.id,otherRoom,'smoke');g.bet(a.id,otherRoom,'candy',10,'show');
 const current=g.history(a.id,{betsOnly:true});assert.equal(current.length,3);assert.equal(current[0].ownCar,null);assert.equal(current[0].bets[0].status,'pending');assert.ok(current.every(r=>r.bets.length));assert.equal(g.history(other.user.id,{betsOnly:true}).length,1);
 const {createServer}=await import('./http.js');const server=createServer(g);await new Promise(r=>server.listen(0,'127.0.0.1',r));try{const session=g.login('Alice','test-password-123'),url='http://127.0.0.1:'+server.address().port+'/api/history?betsOnly=1';assert.equal((await fetch(url)).status,401);const response=await fetch(url,{headers:{Authorization:'Bearer '+session.token}});assert.equal(response.status,200);assert.deepEqual((await response.json()).history,current);}finally{await new Promise(r=>server.close(r));}
});
