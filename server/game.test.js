// Legacy v7 compatibility fixture; current paid specials are covered by the special-powers checks.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Game, RULES } from "./game.js";
import { createServer } from "./http.js";
import { simulateLiveRace, raceFinishedAt } from "./race-simulation.js";
import { generateRace } from "../race-core.js";
function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "carrace-test-"));
  let now = 100000;
  const db = path.join(dir, "game.sqlite"),
    game = new Game(db, { specials:false, clock: () => now, bettingMs: 1000, duration: 10 });
  t.after(() => {
    try {
      game.close();
    } catch {}
    rmSync(dir, { recursive: true, force: true });
  });
  return { game, db, advance: (n) => (now += n), clock: () => now };
}
const user = (g, name) => g.register(name, "good-password-123");

test("race simulation uses frozen purchased levels and survives a restart without rerolling", (t) => {
  const {game:g, db, clock, advance} = fixture(t), a = user(g, 'Trained');
  g.upgrade(a.user.id, 'speed'); g.upgrade(a.user.id, 'stamina'); g.upgrade(a.user.id, 'focus');
  const code = g.create(a.user.id); g.start(a.user.id, code);
  const entries = JSON.parse(g.latest(code).entrants);
  assert.deepEqual(entries.find(e => e.userId === a.user.id), {
    car: 'candy', userId: a.user.id, username: 'Trained', speed: 1, stamina: 1, focus: 1, upgrades: {},
  });
  advance(1001); g.tick();
  const def = g.room(a.user.id, code).race.definition;
  assert.equal(def.simulation.model, 'skills-v7-live');
  assert.equal(def.live, true);
  assert.equal(def.seed, 'live');
  assert.deepEqual(def.outcome, []);
  assert.equal(def.events.length,0);
  const live=g.one('SELECT * FROM live_races WHERE race_id=?',def.id);
  const replay = simulateLiveRace(live.seed, {entrants: entries, duration: 10, title: def.title});
  replay.id = def.id;
  assert.deepEqual(replay, JSON.parse(g.latest(code).definition));
  assert.equal(replay.events.filter(e=>e.power&&e.actor==='candy').length,0);
  assert.equal(g.latest(code).ends, g.latest(code).starts + raceFinishedAt(replay) * 1000);
  const restored = new Game(db, {clock});
  try {
    assert.deepEqual(restored.room(a.user.id, code).race.definition, def);
    advance(10000); restored.tick();
    assert.deepEqual(restored.room(a.user.id, code).race.results.map(r => r.car), replay.outcome);
    const profile = restored.profile(a.user.id); restored.tick();
    assert.deepEqual(restored.profile(a.user.id), profile);
    assert.equal(profile.speed, 1); assert.equal(profile.stamina, 1); assert.equal(profile.focus, 1);
  } finally { restored.close(); }
});

test("older stored race definitions keep their outcome and payouts after an engine update", (t) => {
  const {game:g, db, clock, advance} = fixture(t), a = user(g, 'Returning');
  const code = g.create(a.user.id); g.start(a.user.id, code);
  const r = g.latest(code), old = generateRace('legacy-in-flight', {duration: 10});
  old.id = r.id;
  g.run('DELETE FROM live_races WHERE race_id=?',r.id);
  g.run("UPDATE races SET phase='racing',definition=? WHERE id=?", JSON.stringify(old), r.id);
  advance(12000);
  const restored = new Game(db, {clock});
  try {
    restored.tick();
    assert.deepEqual(restored.room(a.user.id, code).race.definition, old);
    assert.deepEqual(restored.room(a.user.id, code).race.results.map(e => e.car), old.outcome);
    assert.equal(restored.profile(a.user.id).races, 1);
  } finally { restored.close(); }
});
test("accounts use hashed passwords, case-insensitive names and expiring hashed sessions", (t) => {
  const { game: g, advance } = fixture(t),
    a = user(g, "Alice");
  assert.equal(a.user.coins, 1000);
  assert.equal(g.auth(a.token), a.user.id);
  assert.equal(g.login("ALICE", "good-password-123").user.id, a.user.id);
  assert.throws(() => user(g, "alice"), /taken/);
  assert.throws(() => g.login("Alice", "bad-password"), /Invalid/);
  const raw = g.one("SELECT * FROM users");
  assert.notEqual(raw.password_hash, "good-password-123");
  assert.notEqual(g.one("SELECT * FROM sessions").token_hash, a.token);
  advance(31 * 86400000);
  assert.throws(() => g.auth(a.token), /expired/);
});
test("car and upgrades persist across database restarts; coins cannot be overspent", (t) => {
  const { game: g, db, clock } = fixture(t),
    a = user(g, "Alice");
  g.car(a.user.id, "smoke");
  g.upgrade(a.user.id, "speed");
  g.upgrade(a.user.id, "speed");
  assert.equal(g.profile(a.user.id).coins, 400);
  assert.throws(() => g.upgrade(a.user.id, "speed"), /Not enough/);
  assert.equal(g.profile(a.user.id).speed, 2);
  const restored = new Game(db, { clock });
  try {
    assert.equal(restored.auth(a.token), a.user.id);
    const p = restored.login("alice", "good-password-123").user;
    assert.equal(p.car, "smoke");
    assert.equal(p.speed, 2);
    assert.equal(p.coins, 400);
  } finally {
    restored.close();
  }
});
test("rooms enforce host, capacity, unique cars and frozen race entries", (t) => {
  const { game: g } = fixture(t),
    a = user(g, "Alice"),
    b = user(g, "Bobby"),
    room = g.create(a.user.id);
  assert.throws(() => g.join(b.user.id, room), /taken/);
  g.car(b.user.id, "prism");
  g.join(b.user.id, room);
  assert.throws(() => g.start(b.user.id, room), /host/);
  g.start(a.user.id, room);
  for (const action of [
    () => g.car(a.user.id, "smoke"),
    () => g.upgrade(a.user.id, "focus"),
    () => g.leave(a.user.id),
    () => g.create(a.user.id),
  ])
    assert.throws(action, /after/);
  assert.equal(g.room(a.user.id, room).members.length, 2);
});
test("no result exists before betting closes; immutable bets and exactly-once awards", (t) => {
  const { game: g, advance } = fixture(t),
    a = user(g, "Alice"),
    b = user(g, "Bobby");
  g.car(b.user.id, "prism");
  const room = g.create(a.user.id);
  g.join(b.user.id, room);
  g.start(a.user.id, room);
  assert.equal(g.latest(room).definition, null);
  assert.equal(g.room(a.user.id, room).race.definition, null);
  assert.throws(() => g.bet(a.user.id, room, "candy", -10), /Bet/);
  g.bet(a.user.id, room, "candy", 100);
  assert.equal(g.profile(a.user.id).coins, 900);
  assert.throws(() => g.bet(a.user.id, room, "candy", 100), /already/);
  advance(1000);
  assert.throws(() => g.bet(b.user.id, room, "candy", 100), /closed/);
  g.tick();
  const racing = g.room(a.user.id, room).race;
  assert.equal(racing.phase, "racing");
  assert.equal(racing.definition.id, racing.id);
  advance(10000);
  g.tick();
  const result = g.room(a.user.id, room).race,
    finish = result.results.find((e) => e.userId === a.user.id);
  assert.equal(
    g.profile(a.user.id).coins,
    900 + finish.prize + (result.definition.outcome[0] === "candy" ? 400 : 0),
  );
  assert.equal(g.profile(a.user.id).points, finish.points);
  assert.equal(g.profile(a.user.id).races, 1);
  const before = JSON.stringify(g.profile(a.user.id));
  for (let i = 0; i < 5; i++) g.tick();
  assert.equal(JSON.stringify(g.profile(a.user.id)), before);
  assert.equal(result.results.length, 7);
  assert.deepEqual(
    result.results.map((e) => e.prize),
    RULES.prizes,
  );
});
test("race settlement recovers after server restart even without connected players", (t) => {
  const { game: g, db, advance, clock } = fixture(t),
    a = user(g, "Alice"),
    room = g.create(a.user.id);
  g.start(a.user.id, room);
  advance(20000);
  const restored = new Game(db, { clock });
  try {
    restored.tick();
    assert.equal(restored.profile(a.user.id).races, 1);
    assert.equal(restored.room(a.user.id, room).race.phase, "results");
    g.tick();
    assert.equal(g.profile(a.user.id).races, 1);
  } finally {
    restored.close();
  }
});
test("HTTP supports two players, consistent room state, CORS and auth boundaries", async (t) => {
  const { game: g, advance } = fixture(t),
    server = createServer(g, { origins: ["https://islandplumber.github.io"] });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(route, token, body, extra = {}) {
    const r = await fetch(base + route, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...extra,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, data: await r.json() };
  }
  const a = (
      await request("/api/register", null, {
        username: "Alice",
        password: "password-123",
      })
    ).data,
    b = (
      await request("/api/register", null, {
        username: "Bobby",
        password: "password-123",
      })
    ).data;
  assert.equal((await request("/api/me")).status, 401);
  assert.equal((await request("/api/history")).status, 401);
  assert.equal(
    (
      await request("/api/me", a.token, null, {
        Origin: "https://evil.example",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/api/me", a.token, null, {
        Origin: "https://islandplumber.github.io",
      })
    ).status,
    200,
  );
  await request("/api/car", b.token, { car: "smoke" });
  const code = (await request("/api/rooms", a.token, {})).data.code;
  await request(`/api/rooms/${code}/join`, b.token, {});
  assert.equal(
    (await request(`/api/rooms/${code}/start`, b.token, {})).status,
    403,
  );
  await request(`/api/rooms/${code}/start`, a.token, {});
  await request(`/api/rooms/${code}/bets`, b.token, {
    car: "smoke",
    stake: 100,
  });
  advance(1001);
  const ra = (await request(`/api/rooms/${code}`, a.token)).data,
    rb = (await request(`/api/rooms/${code}`, b.token)).data;
  assert.deepEqual(ra.room.race.definition, rb.room.race.definition);
  assert.equal(ra.room.race.bet, null);
  assert.equal(rb.room.race.bet.stake, 100);
  const ah = (await request("/api/history", a.token)).data.history;
  const bh = (await request("/api/history", b.token)).data.history;
  assert.equal(ah.length, 1);
  assert.equal(ah[0].bet, null, "another player's bet is private");
  assert.equal(bh[0].bet.stake, 100);
  assert.equal(bh[0].winner, null, "history does not disclose an unfinished result");
  const outside = user(g, "Outside");
  assert.deepEqual((await request("/api/history", outside.token)).data.history, []);
  assert.equal(
    (await request("/api/money", a.token, { coins: 999999 })).status,
    404,
  );
  advance(10000);
  assert.equal((await request("/api/me", b.token)).data.user.races, 1);
});
test("an empty saved room gives its next player host controls", (t) => {
  const { game: g } = fixture(t),
    a = user(g, "Alice"),
    b = user(g, "Bobby"),
    code = g.create(a.user.id);
  g.leave(a.user.id);
  g.join(b.user.id, code);
  assert.equal(g.room(b.user.id, code).hostId, b.user.id);
  g.start(b.user.id, code);
  assert.equal(g.latest(code).phase, "betting");
});

test("a full room settles a guaranteed winning bet and every losing bet correctly", (t) => {
  const { game: g, advance } = fixture(t);
  const cars = [
    "ironhart",
    "seven",
    "crown",
    "junior",
    "candy",
    "prism",
    "smoke",
  ];
  const people = cars.map((car, i) => {
    const a = user(g, `Player${i}`);
    g.car(a.user.id, car);
    return g.profile(a.user.id);
  });
  const room = g.create(people[0].id);
  for (const p of people.slice(1)) g.join(p.id, room);
  const eighth = user(g, "Eighth");
  assert.throws(() => g.join(eighth.user.id, room), /full/);
  g.start(people[0].id, room);
  for (const p of people) g.bet(p.id, room, p.car, 100);
  advance(12000);
  g.tick();
  const r = g.room(people[0].id, room).race;
  for (const p of people) {
    const e = r.results.find((e) => e.userId === p.id),
      bet = g.room(p.id, room).race.bet;
    const payout = e.place === 1 ? 400 : 0;
    assert.equal(bet.payout, payout);
    assert.equal(g.profile(p.id).coins, 900 + e.prize + payout);
    assert.equal(g.profile(p.id).points, e.points);
  }
  assert.equal(g.raceBets(r.id).filter(b => b.payout > 0).length, 1);
});

test("saved slips separate winning bets, losing bets and finish prizes across rooms and restarts", (t) => {
  const { game: g, db, advance, clock } = fixture(t);
  const a = user(g, "Island");
  const code = g.create(a.user.id);
  g.start(a.user.id, code);
  g.bet(a.user.id, code, "ironhart", 50);
  const pending = g.history(a.user.id)[0];
  assert.equal(pending.bet.status, "pending");
  assert.equal(pending.bet.payout, null);
  assert.equal(pending.winner, null);
  assert.equal(pending.netCoins, -50);
  advance(11001);
  g.settle(g.latest(code), { outcome: ["ironhart", "seven", "crown", "junior", "candy", "prism", "smoke"] });
  assert.equal(g.profile(a.user.id).coins, 1200);
  assert.equal(g.profile(a.user.id).points, 3);
  g.start(a.user.id, code);
  g.bet(a.user.id, code, "candy", 50);
  advance(11001);
  g.settle(g.latest(code), { outcome: ["ironhart", "candy", "smoke", "prism", "seven", "crown", "junior"] });
  assert.equal(g.profile(a.user.id).coins, 1290);
  assert.equal(g.profile(a.user.id).points, 12);
  const history = g.history(a.user.id);
  assert.deepEqual(history.map((r) => ({ number: r.number, ownCar: r.ownCar, place: r.place, prize: r.prize, points: r.points, bet: r.bet, netCoins: r.netCoins })), [
    { number: 2, ownCar: "candy", place: 2, prize: 140, points: 9, bet: {car:"candy",stake:50,payout:0,net:-50,status:"lost"},netCoins:90 },
    { number: 1, ownCar: "candy", place: 5, prize: 50, points: 3, bet: {car:"ironhart",stake:50,payout:200,net:150,status:"won"},netCoins:200 },
  ]);
  g.upgrade(a.user.id, "speed");
  g.car(a.user.id, "prism");
  g.leave(a.user.id);
  g.create(a.user.id);
  assert.deepEqual(g.history(a.user.id), history, "later upgrades, car changes and rooms cannot rewrite old slips");
  const restored = new Game(db, { clock });
  try { assert.deepEqual(restored.history(a.user.id), history); } finally { restored.close(); }
});

test("room discovery includes online presence and switching chooses a free car atomically", (t) => {
  const {game:g,advance}=fixture(t);
  const a=user(g,'Alice'),b=user(g,'Bobby');
  const first=g.create(a.user.id),second=g.create(b.user.id);
  assert.equal(g.onlineCount(),2);
  assert.equal(g.rooms().find(r=>r.code===second).online,1);
  assert.equal(g.rooms().find(r=>r.code===second).phase,'waiting');
  assert.throws(()=>g.join(a.user.id,second,'candy'),/taken/);
  assert.equal(g.membership(a.user.id),first,'failed join preserves the old room');
  assert.equal(g.profile(a.user.id).car,'candy');
  g.join(a.user.id,second,'smoke');
  assert.equal(g.membership(a.user.id),second);
  assert.equal(g.profile(a.user.id).car,'smoke');
  assert.equal(g.rooms().find(r=>r.code===second).players,2);
  g.start(b.user.id,second);
  const c=user(g,'Carol'),third=g.create(c.user.id);
  assert.throws(()=>g.join(a.user.id,third,'prism'),/after/);
  assert.equal(g.membership(a.user.id),second);
  assert.equal(g.profile(a.user.id).car,'smoke');
  advance(31000);assert.equal(g.onlineCount(),0);
  g.auth(c.token);assert.equal(g.onlineCount(),1);
  assert.equal(g.rooms().find(r=>r.code===third).online,1);
  assert.equal(g.rooms().find(r=>r.code===second).online,0);
});

test("an online racer takes over an abandoned room after the grace period", (t)=>{
 const {game:g,advance}=fixture(t),a=user(g,'Alice'),b=user(g,'Bobby');
 const room=g.create(a.user.id);g.join(b.user.id,room,'smoke');
 assert.equal(g.room(b.user.id,room).hostId,a.user.id);
 advance(31000);g.auth(b.token);
 assert.equal(g.room(b.user.id,room).hostId,b.user.id);
 g.start(b.user.id,room);
 assert.equal(g.latest(room).phase,'betting');
});
