import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { ACTOR_IDS } from "../race-core.js";
import { simulateRace, simulateLiveRace, publicLiveRace, nextLiveActivationTime, raceFinishedAt, LIVE_POWER_COOLDOWN } from "./race-simulation.js";
import { BET_TYPES, ticketReturn } from "../betting.js";
import {UPGRADES,upgradeCost,finishPrize} from '../progression.js';
import {SPECIAL_POWER_POLICY,specialPowerCost,SPECIAL_POWERS} from '../powers.js';
export const RULES = {
  startingCoins: 1000,
  prizes: [200, 140, 100, 75, 50, 35, 25],
  points: [12, 9, 7, 5, 3, 2, 1],
  minBet: 10,
  maxBet: 500,
  betReturn: 4,
  betTypes: BET_TYPES,
  upgrades: { speed: 120, stamina: 100, focus: 90 },
  maxLevel: 5,
  workshop: UPGRADES,
  specialPower: SPECIAL_POWER_POLICY,
};
export class GameError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
function requireThat(ok, message, status = 400) {
  if (!ok) throw new GameError(message, status);
}
const hashToken = (t) => createHash("sha256").update(t).digest("hex");
export class Game {
  constructor(
    file,
    { clock = Date.now, bettingMs = 30000, duration = 64, specials = true } = {},
  ) {
    this.clock = clock;
    this.bettingMs = bettingMs;
    this.duration = duration;
    this.specials = specials;
    this.presence = new Map();
    this.startedAt = this.clock();
    this.db = new DatabaseSync(file);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT NOT NULL, name_key TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL, coins INTEGER NOT NULL CHECK(coins>=0), points INTEGER NOT NULL DEFAULT 0, car TEXT NOT NULL DEFAULT 'candy', speed INTEGER NOT NULL DEFAULT 0, stamina INTEGER NOT NULL DEFAULT 0, focus INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0, races INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE IF NOT EXISTS player_upgrades(user_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,level INTEGER NOT NULL CHECK(typeof(level)='integer' AND level>=0),PRIMARY KEY(user_id,kind));
   CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS rooms(code TEXT PRIMARY KEY, host_id TEXT NOT NULL REFERENCES users(id), created INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS club_rooms(kind TEXT PRIMARY KEY CHECK(kind='main'),code TEXT UNIQUE NOT NULL REFERENCES rooms(code));
   CREATE TABLE IF NOT EXISTS members(user_id TEXT PRIMARY KEY REFERENCES users(id), code TEXT NOT NULL REFERENCES rooms(code));
   CREATE TABLE IF NOT EXISTS races(id TEXT PRIMARY KEY, code TEXT NOT NULL REFERENCES rooms(code), number INTEGER NOT NULL, phase TEXT NOT NULL, closes INTEGER NOT NULL, starts INTEGER NOT NULL, ends INTEGER NOT NULL, entrants TEXT NOT NULL, definition TEXT, results TEXT);
   CREATE TABLE IF NOT EXISTS bets(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), race_id TEXT NOT NULL REFERENCES races(id), car TEXT NOT NULL, stake INTEGER NOT NULL, payout INTEGER, UNIQUE(user_id,race_id));
   CREATE TABLE IF NOT EXISTS ledger(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), delta INTEGER NOT NULL, reason TEXT NOT NULL, race_id TEXT, created INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS race_bets(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), race_id TEXT NOT NULL REFERENCES races(id), car TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('win','place','show')), stake INTEGER NOT NULL CHECK(typeof(stake)='integer' AND stake BETWEEN 10 AND 500), return_units INTEGER NOT NULL CHECK(return_units>=100), payout INTEGER CHECK(payout IS NULL OR (typeof(payout)='integer' AND payout>=0)), UNIQUE(user_id,race_id,kind));
   CREATE TABLE IF NOT EXISTS live_races(race_id TEXT PRIMARY KEY REFERENCES races(id),seed TEXT NOT NULL,duration REAL NOT NULL,revision INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE IF NOT EXISTS race_power_uses(request_id TEXT PRIMARY KEY,race_id TEXT NOT NULL REFERENCES races(id),user_id TEXT NOT NULL REFERENCES users(id),actor TEXT NOT NULL,time REAL NOT NULL,charge INTEGER NOT NULL,created INTEGER NOT NULL,UNIQUE(race_id,user_id,charge));
   CREATE TABLE IF NOT EXISTS race_power_rules(race_id TEXT PRIMARY KEY REFERENCES races(id),rules TEXT NOT NULL);`);
  }
  one(sql, ...p) {
    return this.db.prepare(sql).get(...p);
  }
  all(sql, ...p) {
    return this.db.prepare(sql).all(...p);
  }
  run(sql, ...p) {
    return this.db.prepare(sql).run(...p);
  }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  close() {
    this.db.close();
  }
  profile(id) {
    const u = this.one(
      "SELECT id,username,coins,points,car,speed,stamina,focus,wins,races FROM users WHERE id=?",
      id,
    );
    requireThat(u, "Sign in again.", 401);
    return {...u,upgrades:this.workshop(id)};
  }
  workshop(id){return Object.fromEntries(this.all('SELECT kind,level FROM player_upgrades WHERE user_id=? ORDER BY kind',id).map(r=>[r.kind,r.level]));}
  session(id) {
    this.touch(id);
    const token = randomBytes(32).toString("base64url");
    this.run("DELETE FROM sessions WHERE expires<?", this.clock());
    this.run(
      "INSERT INTO sessions VALUES(?,?,?)",
      hashToken(token),
      id,
      this.clock() + 30 * 86400000,
    );
    return { token, user: this.profile(id) };
  }
  register(username, password) {
    requireThat(
      typeof username === "string" && /^[a-zA-Z0-9_]{3,20}$/.test(username),
      "Use 3–20 letters, numbers or underscores for your username.",
    );
    requireThat(
      typeof password === "string" &&
        password.length >= 8 &&
        password.length <= 128,
      "Use a password of 8–128 characters.",
    );
    const salt = randomBytes(16).toString("hex"),
      digest = scryptSync(password, salt, 64).toString("hex");
    return this.transaction(() => {
      requireThat(
        !this.one(
          "SELECT id FROM users WHERE name_key=?",
          username.toLowerCase(),
        ),
        "That username is taken.",
        409,
      );
      const id = randomUUID();
      this.run(
        "INSERT INTO users(id,username,name_key,salt,password_hash,coins) VALUES(?,?,?,?,?,?)",
        id,
        username,
        username.toLowerCase(),
        salt,
        digest,
        RULES.startingCoins,
      );
      this.run(
        "INSERT INTO ledger VALUES(?,?,?,?,?,?)",
        randomUUID(),
        id,
        RULES.startingCoins,
        "Starting bankroll",
        null,
        this.clock(),
      );
      return this.session(id);
    });
  }
  login(username, password) {
    requireThat(
      typeof username === "string" &&
        typeof password === "string" &&
        password.length <= 128,
      "Invalid username or password.",
      401,
    );
    const u = this.one(
      "SELECT * FROM users WHERE name_key=?",
      username.toLowerCase(),
    );
    const actual = scryptSync(
      password,
      u?.salt ?? "missing-user-dummy-salt",
      64,
    );
    requireThat(
      u && timingSafeEqual(actual, Buffer.from(u.password_hash, "hex")),
      "Invalid username or password.",
      401,
    );
    return this.session(u.id);
  }
  auth(token) {
    requireThat(
      typeof token === "string" && token.length < 200,
      "Sign in to continue.",
      401,
    );
    const s = this.one(
      "SELECT user_id FROM sessions WHERE token_hash=? AND expires>?",
      hashToken(token),
      this.clock(),
    );
    requireThat(s, "Your session expired. Sign in again.", 401);
    this.touch(s.user_id);
    return s.user_id;
  }
  logout(token) {
    this.run("DELETE FROM sessions WHERE token_hash=?", hashToken(token));
  }
  membership(id) {
    return (
      this.one("SELECT code FROM members WHERE user_id=?", id)?.code ?? null
    );
  }
  latest(code) {
    return this.one(
      "SELECT * FROM races WHERE code=? ORDER BY number DESC LIMIT 1",
      code,
    );
  }
  active(id) {
    const code = this.membership(id),
      r = code && this.latest(code);
    return (
      r &&
      r.phase !== "results" &&
      JSON.parse(r.entrants).some((e) => e.userId === id)
    );
  }
  credit(id, delta, reason, raceId, key = randomUUID()) {
    const inserted = this.run(
      "INSERT OR IGNORE INTO ledger VALUES(?,?,?,?,?,?)",
      key,
      id,
      delta,
      reason,
      raceId,
      this.clock(),
    );
    if (inserted.changes) {
      const result = this.run(
        "UPDATE users SET coins=coins+? WHERE id=? AND coins+?>=0",
        delta,
        id,
        delta,
      );
      requireThat(result.changes, "Not enough coins.");
    }
    return Boolean(inserted.changes);
  }
  car(id, car) {
    requireThat(ACTOR_IDS.includes(car), "Choose an available car.");
    return this.transaction(() => {
      requireThat(!this.active(id), "Change your car after this race.");
      const code = this.membership(id);
      requireThat(
        !code ||
          !this.one(
            "SELECT u.id FROM members m JOIN users u ON m.user_id=u.id WHERE m.code=? AND u.car=? AND u.id<>?",
            code,
            car,
            id,
          ),
        "That car is already selected in this room.",
      );
      this.run("UPDATE users SET car=? WHERE id=?", car, id);
      return this.profile(id);
    });
  }
  upgrade(id, kind, expectedLevel) {
    requireThat(typeof kind==='string'&&(Object.hasOwn(RULES.upgrades, kind)||Object.hasOwn(UPGRADES,kind)), "Unknown upgrade.");
    return this.transaction(() => {
      requireThat(!this.active(id), "Buy upgrades after this race.");
      if(Object.hasOwn(UPGRADES,kind)){
        const u=this.profile(id),level=u.upgrades[kind]??0,cost=upgradeCost(kind,level,u.upgrades);
        requireThat(expectedLevel===undefined||Number.isSafeInteger(expectedLevel)&&expectedLevel===level,'This level changed. Refresh before buying again.',409);
        requireThat(cost!==null,'This upgrade is at its maximum level.');
        this.credit(id,-cost,`${UPGRADES[kind].name} · level ${level+1}`,null,`workshop:${id}:${kind}:${level+1}`);
        this.run('INSERT INTO player_upgrades(user_id,kind,level) VALUES(?,?,?) ON CONFLICT(user_id,kind) DO UPDATE SET level=excluded.level',id,kind,level+1);
        return this.profile(id);
      }
      const u = this.profile(id),
        level = u[kind];
      requireThat(
        level < RULES.maxLevel,
        "This upgrade is at its maximum level.",
      );
      const cost = RULES.upgrades[kind] * (level + 1) ** 2;
      this.credit(id, -cost, `${kind} upgrade`, null);
      this.run(`UPDATE users SET ${kind}=${kind}+1 WHERE id=?`, id);
      return this.profile(id);
    });
  }
  touch(id) {
    const now = this.clock();
    this.presence.set(id, now);
    if (this.presence.size > 10000)
      for (const [key, last] of this.presence) if (last < now - 30000) this.presence.delete(key);
  }
  isOnline(id) { return (this.presence.get(id)??-Infinity)>=this.clock()-30000; }
  onlineCount() {
    return [...this.presence.values()].filter((last) => last >= this.clock() - 30000).length;
  }
  rooms() {
    const main=this.mainRoomCode();
    return this.all(
      "SELECT r.code, COUNT(m.user_id) AS players FROM rooms r LEFT JOIN members m ON m.code=r.code GROUP BY r.code HAVING COUNT(m.user_id)>0 OR r.code=? ORDER BY r.created DESC",
      main??"",
    ).map((room) => {
      const people = this.all("SELECT u.id,u.username,u.car FROM members m JOIN users u ON u.id=m.user_id WHERE m.code=?", room.code);
      const members = people.map((p) => ({ username: p.username, car: p.car, online: this.isOnline(p.id) }));
      return { ...room, main: room.code===main, online: members.filter((p) => p.online).length, members,
        phase: this.latest(room.code)?.phase ?? "waiting", capacity: 7 };
    }).sort((a,b) => Number(b.main)-Number(a.main) || b.online-a.online || b.players-a.players).slice(0,30);
  }
  transferAwayHost(code) {
    // A restart gets a grace period so the first reconnect cannot steal hosting.
    if (this.clock() - this.startedAt < 30000) return;
    const room = this.one("SELECT host_id FROM rooms WHERE code=?", code);
    if (!room || (this.presence.get(room.host_id) ?? -Infinity) >= this.clock()-30000) return;
    const next = this.all("SELECT user_id FROM members WHERE code=? ORDER BY rowid", code)
      .find((m) => (this.presence.get(m.user_id) ?? -Infinity) >= this.clock()-30000);
    if (next) this.run("UPDATE rooms SET host_id=? WHERE code=? AND host_id=?", next.user_id, code, room.host_id);
  }
  leaveInside(id) {
    requireThat(!this.active(id), "You can leave after the current race.");
    const code = this.membership(id);
    if (!code) return;
    this.run("DELETE FROM members WHERE user_id=?", id);
    const next = this.one(
      "SELECT user_id FROM members WHERE code=? ORDER BY user_id LIMIT 1",
      code,
    );
    if (next)
      this.run(
        "UPDATE rooms SET host_id=? WHERE code=? AND host_id=?",
        next.user_id,
        code,
        id,
      );
  }
  reclaimIdleMembers(code, exceptId) {
    // Keep reconnect and restart grace; frozen racers and their payouts stay put.
    if(this.clock()-this.startedAt<120000)return;
    for(const {user_id:id} of this.all('SELECT user_id FROM members WHERE code=?',code)){
      if(id!==exceptId&&(this.presence.get(id)??-Infinity)<this.clock()-120000&&!this.active(id))this.leaveInside(id);
    }
  }
  leave(id) {
    return this.transaction(() => this.leaveInside(id));
  }
  mainRoomCode() { return this.one("SELECT code FROM club_rooms WHERE kind='main'")?.code ?? null; }
  createInside(id) {
    this.leaveInside(id);
    let code;
    do { code=randomBytes(4).toString('hex').slice(0,6).toUpperCase(); }
    while(this.one('SELECT code FROM rooms WHERE code=?',code));
    this.run('INSERT INTO rooms VALUES(?,?,?)',code,id,this.clock());
    this.run('INSERT INTO members VALUES(?,?)',id,code);
    return code;
  }
  create(id) { return this.transaction(()=>this.createInside(id)); }
  joinInside(id, code, car) {
      requireThat(
        this.one("SELECT code FROM rooms WHERE code=?", code),
        "Room not found.",
        404,
      );
      if (this.membership(id) === code) return code;
      this.reclaimIdleMembers(code,id);
      requireThat(
        this.one("SELECT COUNT(*) AS n FROM members WHERE code=?", code).n < 7,
        "This room is full.",
      );
      const u = this.profile(id);
      const selected = car ?? u.car;
      requireThat(ACTOR_IDS.includes(selected), "Choose an available car.");
      requireThat(
        !this.one(
          "SELECT u.id FROM members m JOIN users u ON u.id=m.user_id WHERE m.code=? AND u.car=?",
          code,
          selected,
        ),
        "That car is taken in this room. Choose another car first.",
      );
      this.leaveInside(id);
      if (selected !== u.car) this.run("UPDATE users SET car=? WHERE id=?", selected, id);
      this.run("INSERT INTO members VALUES(?,?)", id, code);
      if (
        this.one("SELECT COUNT(*) AS n FROM members WHERE code=?", code).n === 1
      )
        this.run("UPDATE rooms SET host_id=? WHERE code=?", id, code);
      return code;
  }
  join(id, code, car) {
    requireThat(typeof code==='string','Enter a room code.');
    return this.transaction(()=>this.joinInside(id,code.toUpperCase(),car));
  }
  arrive(id, {switchRoom=false}={}) {
    return this.transaction(()=>{
      this.touch(id);
      const current=this.membership(id);
      if(current&&!switchRoom){
        if(!this.mainRoomCode())this.run("INSERT INTO club_rooms VALUES('main',?)",this.rooms().find(r=>r.online>0)?.code??current);
        return current;
      }
      requireThat(!this.active(id),'Finish this race before changing rooms.');
      let main=this.mainRoomCode();
      if(!main){
        // Adopt an occupied public room so deployment does not split the people
        // already playing. No existing member, race or host is moved.
        main=this.rooms().find(r=>r.online>0)?.code;
        if(!main)main=this.createInside(id);
        this.run("INSERT INTO club_rooms VALUES('main',?)",main);
      }
      if(this.membership(id)===main)return main;
      this.reclaimIdleMembers(main,id);
      if(switchRoom)requireThat(this.one('SELECT COUNT(*) AS n FROM members WHERE code=?',main).n<7,'The main room is full (7/7). Choose another room.');
      const rooms=this.rooms(),primary=rooms.find(r=>r.code===main),open=r=>r.players<7;
      const target=(switchRoom?{code:main}:null)??(primary&&open(primary)&&primary.online>0?primary:null)
        ??rooms.filter(r=>r.online>0&&open(r)).sort((a,b)=>b.online-a.online||b.players-a.players)[0]
        ??(this.one('SELECT COUNT(*) AS n FROM members WHERE code=?',main).n<7?{code:main}:null);
      if(!target)return this.createInside(id); // A seven-seat field needs another room.
      const u=this.profile(id),taken=new Set(this.all('SELECT u.car FROM users u JOIN members m ON m.user_id=u.id WHERE m.code=? AND u.id<>?',target.code,id).map(r=>r.car));
      const car=!taken.has(u.car)?u.car:ACTOR_IDS.find(h=>!taken.has(h));
      return this.joinInside(id,target.code,car);
    });
  }
  start(id, code) {
    this.touch(id); // Starting a round is itself a live player action.
    return this.transaction(() => {
      const room = this.one("SELECT * FROM rooms WHERE code=?", code);
      requireThat(
        room && room.host_id === id && this.membership(id) === code,
        "Only the room host can open betting.",
        403,
      );
      const last = this.latest(code);
      requireThat(
        !last || last.phase === "results",
        "A race is already underway.",
      );
      const people = this.all(
        "SELECT u.id,u.username,u.car,u.speed,u.stamina,u.focus FROM members m JOIN users u ON u.id=m.user_id WHERE m.code=?",
        code,
      );
      const onlinePeople=people.filter(u=>this.isOnline(u.id));
      const entrants = ACTOR_IDS.map((car) => {
        const u = onlinePeople.find((p) => p.car === car);
        return {
          car,
          userId: u?.id ?? null,
          username: u?.username ?? `${car} (CPU)`,
          speed: u?.speed ?? 0,
          stamina: u?.stamina ?? 0,
          focus: u?.focus ?? 0,
          ...(u?{upgrades:this.workshop(u.id)}:{}),
        };
      });
      const raceId = randomUUID(),
        closes = this.clock() + this.bettingMs;
      this.run(
        "INSERT INTO races VALUES(?,?,?,?,?,?,?,?,?,?)",
        raceId,
        code,
        (last?.number ?? 0) + 1,
        "betting",
        closes,
        closes,
        closes + this.duration * 1000,
        JSON.stringify(entrants),
        null,
        null,
      );
      // New rounds opt into live controls explicitly. Older in-flight rounds
      // retain their original engine and saved outcome across this migration.
      this.run("INSERT INTO live_races(race_id,seed,duration) VALUES(?,?,?)",raceId,randomBytes(16).toString("hex"),this.duration);
      if(this.specials)this.run('INSERT INTO race_power_rules VALUES(?,?)',raceId,JSON.stringify({...SPECIAL_POWER_POLICY,costs:Object.fromEntries(entrants.filter(e=>e.userId).map(e=>[e.car,specialPowerCost(e.upgrades)]))}));
      return raceId;
    });
  }
  raceBets(raceId, userId) {
    const clause = userId === undefined ? "" : " AND user_id=?";
    const args = userId === undefined ? [raceId] : [raceId, userId];
    return this.all(`SELECT id,user_id,car,kind,stake,return_units,payout,0 AS legacy FROM race_bets WHERE race_id=?${clause}
      UNION ALL SELECT id,user_id,car,'win' AS kind,stake,400 AS return_units,payout,1 AS legacy FROM bets WHERE race_id=?${clause}`,
      ...args, ...args).sort((a,b) => Object.keys(BET_TYPES).indexOf(a.kind)-Object.keys(BET_TYPES).indexOf(b.kind));
  }
  ticketViews(raceId, userId, results) {
    return this.raceBets(raceId, userId).map((b) => ({
      kind: b.kind, car: b.car, stake: b.stake, returnUnits: b.return_units,
      payout: b.payout, net: b.payout === null ? null : b.payout - b.stake,
      status: b.payout === null ? "pending" : b.payout > 0 ? "won" : "lost",
      place: results?.find((r) => r.car === b.car)?.place ?? null,
    }));
  }
  bet(id, code, car, stake, kind = "win") {
    return this.transaction(() => {
      requireThat(this.membership(id) === code, "Join this room first.", 403);
      const r = this.latest(code);
      requireThat(
        r?.phase === "betting" && this.clock() < r.closes,
        "Betting has closed.",
      );
      requireThat(ACTOR_IDS.includes(car), "Choose a car.");
      requireThat(typeof kind === "string" && Object.hasOwn(BET_TYPES, kind), "Choose Win, Place or Show.");
      requireThat(
        Number.isInteger(stake) &&
          stake >= RULES.minBet &&
          stake <= RULES.maxBet,
        `Bet ${RULES.minBet}–${RULES.maxBet} whole coins.`,
      );
      requireThat(
        !this.raceBets(r.id, id).some((b) => b.kind === kind),
        `You already placed your ${kind} bet.`,
        409,
      );
      this.credit(id, -stake, `${BET_TYPES[kind].label} bet`, r.id);
      this.run(
        "INSERT INTO race_bets(id,user_id,race_id,car,kind,stake,return_units,payout) VALUES(?,?,?,?,?,?,?,NULL)",
        randomUUID(),
        id,
        r.id,
        car,
        kind,
        stake,
        BET_TYPES[kind].units,
      );
    });
  }
  prepare(r) {
    const live=this.one("SELECT * FROM live_races WHERE race_id=?",r.id);
    const def = (live?simulateLiveRace:simulateRace)(live?.seed??randomBytes(16).toString("hex"), {
      entrants: JSON.parse(r.entrants),
      duration: live?.duration??(r.ends - r.starts) / 1000,
      title: `Room ${r.code} · Race ${r.number}`,
      ...(live?{activations:[]}:{}),
      specials:Boolean(this.powerRules(r.id)),
    });
    def.id = r.id;
    this.run(
      "UPDATE races SET phase='racing', definition=?,ends=? WHERE id=? AND phase='betting'",
      JSON.stringify(def),
      r.starts + (live?raceFinishedAt(def):def.duration) * 1000,
      r.id,
    );
    return def;
  }
  powerUses(raceId) {
    return this.all("SELECT * FROM race_power_uses WHERE race_id=? ORDER BY time,actor,charge",raceId);
  }
  powerRules(raceId){const row=this.one('SELECT rules FROM race_power_rules WHERE race_id=?',raceId);return row?JSON.parse(row.rules):null;}
  powerSpent(id,raceId){return Math.max(0,-(this.one('SELECT delta FROM ledger WHERE id=?',`power:${raceId}:${id}`)?.delta??0));}
  powerStatus(id,r,def,live) {
    const entrant=JSON.parse(r.entrants).find(e=>e.userId===id);
    if(!entrant)return {actor:null,charges:0,used:0,remaining:0,available:false,reason:"spectator",readyAt:null};
    const policy=this.powerRules(r.id),cost=policy?.costs?.[entrant.car]??0;
    const charges=policy?1:(entrant.upgrades?.powerReserve??0)>=5?2:1;
    const uses=live?this.powerUses(r.id).filter(e=>e.user_id===id):[];
    const state={actor:entrant.car,charges,used:uses.length,remaining:Math.max(0,charges-uses.length),available:false,reason:"legacy",readyAt:null,cost,paid:this.powerSpent(id,r.id),paidSpecial:Boolean(policy)};
    if(!live)return state;
    if(r.phase==="betting")return {...state,reason:"betting",readyAt:r.starts};
    if(r.phase==="results")return {...state,reason:"finished"};
    if(!def)return {...state,reason:"gates",readyAt:r.starts};
    const elapsed=(this.clock()-r.starts)/1000;
    const runner=def.cast.find(h=>h.id===entrant.car);
    const finished=runner.progress.some(p=>p.distance>=def.track.length&&p.time<=elapsed);
    if(finished)return {...state,reason:"finished"};
    if(elapsed<def.startDelay)return {...state,reason:"gates",readyAt:r.starts+def.startDelay*1000};
    if(!state.remaining)return {...state,reason:"spent"};
    if(cost>this.profile(id).coins)return {...state,reason:'coins'};
    const latest=uses.at(-1),event=latest&&def.events.find(e=>e.actor===entrant.car&&e.charge===latest.charge);
    const readyAt=event?r.starts+(event.time+Math.max(event.duration,LIVE_POWER_COOLDOWN))*1000:null;
    if(readyAt!==null&&this.clock()<readyAt)return {...state,reason:"cooldown",readyAt};
    return {...state,available:true,reason:"ready",readyAt};
  }
  power(id,code,raceId,requestId,policyVersion) {
    requireThat(typeof requestId==="string"&&/^[a-zA-Z0-9_-]{8,100}$/.test(requestId),"Refresh the page before using your ability.");
    // Advance using the server clock before deciding whether a race is still
    // open. A client can never supply an earlier activation time or an actor.
    this.tick();
    return this.transaction(()=>{
      requireThat(this.membership(id)===code,"Join this room first.",403);
      const r=this.latest(code);
      requireThat(r&&r.id===raceId,"That race has changed. Refresh before using your ability.",409);
      const previous=this.one("SELECT * FROM race_power_uses WHERE request_id=?",requestId);
      if(previous){
        requireThat(previous.user_id===id&&previous.race_id===r.id,"That ability request was already used.",409);
        return {duplicate:true,charge:previous.charge,time:previous.time};
      }
      const live=this.one("SELECT * FROM live_races WHERE race_id=?",r.id);
      requireThat(!this.powerRules(r.id)||policyVersion===1,'Refresh the game to load the paid special-power controls before using a power.',409);
      const def=r.definition?JSON.parse(r.definition):null;
      const state=this.powerStatus(id,r,def,live);
      const reasons={coins:`You need ${state.cost} coins to use this power.`,spectator:"You are watching this race. Your ability is available when you enter the next race.",legacy:"This race uses the earlier automatic abilities. Your controls will be ready next race.",betting:"Wait for the race to start before using your ability.",gates:"Wait for the starting gate to open.",cooldown:"Your ability is still active. Wait for it to finish before using your reserve.",spent:"You have used every ability charge for this race.",finished:"Your car has finished this race."};
      requireThat(state.available,reasons[state.reason]??"Your ability is not ready.",409);
      const time=nextLiveActivationTime(def,(this.clock()-r.starts)/1000);
      const uses=this.powerUses(r.id),charge=state.used+1;
      const next=simulateLiveRace(live.seed,{
        entrants:JSON.parse(r.entrants),duration:live.duration,title:def.title,
        activations:[...uses.map(use=>({actor:use.actor,time:use.time})),{actor:state.actor,time}],specials:Boolean(this.powerRules(r.id)),
      });
      next.id=r.id;
      requireThat(next.events.some(event=>event.actor===state.actor&&event.charge===charge&&event.time>=time-1e-8),"Your car has reached the finish. Save your ability for the next race.",409);
      if(state.cost)this.credit(id,-state.cost,`Signature power · ${SPECIAL_POWERS[state.actor].name}`,r.id,`power:${r.id}:${id}`);
      this.run("INSERT INTO race_power_uses VALUES(?,?,?,?,?,?,?)",requestId,r.id,id,state.actor,time,charge,this.clock());
      this.run("UPDATE live_races SET revision=revision+1 WHERE race_id=?",r.id);
      this.run("UPDATE races SET definition=?,ends=? WHERE id=?",JSON.stringify(next),r.starts+raceFinishedAt(next)*1000,r.id);
      return {duplicate:false,charge,time};
    });
  }
  settle(r, def) {
    const entrants = JSON.parse(r.entrants),
      results = def.outcome.map((car, i) => ({
        ...entrants.find((e) => e.car === car),
        place: i + 1,
        prize: finishPrize(RULES.prizes[i],entrants.find(e=>e.car===car)?.upgrades),
        points: RULES.points[i],
      }));
    for (const e of results) {
      if (!e.userId) continue;
      if (
        this.credit(
          e.userId,
          e.prize,
          `Finished #${e.place}`,
          r.id,
          `prize:${r.id}:${e.userId}`,
        )
      )
        this.run(
          "UPDATE users SET points=points+?,races=races+1,wins=wins+? WHERE id=?",
          e.points,
          e.place === 1 ? 1 : 0,
          e.userId,
        );
    }
    for (const b of this.raceBets(r.id).filter((b) => b.payout === null)) {
      const place = def.outcome.indexOf(b.car) + 1;
      const payout = place > 0 && place <= BET_TYPES[b.kind].places ? ticketReturn(b.stake, b.return_units) : 0;
      if (payout)
        this.credit(b.user_id, payout, b.legacy ? "Winning bet" : `${BET_TYPES[b.kind].label} bet return`, r.id, `bet:${b.id}`);
      this.run(b.legacy ? "UPDATE bets SET payout=? WHERE id=?" : "UPDATE race_bets SET payout=? WHERE id=?", payout, b.id);
    }
    this.run(
      "UPDATE races SET phase='results',results=? WHERE id=?",
      JSON.stringify(results),
      r.id,
    );
  }
  tick() {
    this.transaction(() => {
      for (const r of this.all(
        "SELECT * FROM races WHERE phase<>'results' AND closes<=?",
        this.clock(),
      )) {
        const def = r.definition ? JSON.parse(r.definition) : this.prepare(r);
        const live=this.one("SELECT race_id FROM live_races WHERE race_id=?",r.id);
        if (this.clock() >= r.starts + (live?raceFinishedAt(def):def.duration) * 1000) this.settle(r, def);
      }
    });
  }
  room(id, code) {
    requireThat(this.membership(id) === code, "Join this room first.", 403);
    this.transferAwayHost(code);
    const room = this.one("SELECT * FROM rooms WHERE code=?", code);
    requireThat(room, "Room not found.", 404);
    const members = this.all(
        "SELECT u.id,u.username,u.car,u.speed,u.stamina,u.focus FROM members m JOIN users u ON u.id=m.user_id WHERE m.code=?",
        code,
      ),
      r = this.latest(code),
      tickets = r ? this.ticketViews(r.id, id, r.results ? JSON.parse(r.results) : null) : [];
    const live=r&&this.one("SELECT * FROM live_races WHERE race_id=?",r.id);
    const definition=r?.definition?JSON.parse(r.definition):null;
    const publicDefinition=definition&&live?publicLiveRace(definition,r.phase==="results"?raceFinishedAt(definition):(this.clock()-r.starts)/1000,{id:r.id,revision:live.revision}):definition;
    return {
      code,
      main: code===this.mainRoomCode(),
      hostId: room.host_id,
      members:members.map(m=>({...m,online:this.isOnline(m.id),active:Boolean(r&&r.phase!=="results"&&JSON.parse(r.entrants).some(e=>e.userId===m.id))})),
      race: r
        ? {
            id: r.id,
            number: r.number,
            phase: r.phase,
            closes: r.closes,
            starts: r.starts,
            ends: live&&definition&&r.phase!=="results"?r.starts+definition.duration*1000:r.ends,
            entrants: JSON.parse(r.entrants),
            definition: r.phase === "betting" ? null : publicDefinition,
            revision:live?.revision??0,
            power:this.powerStatus(id,r,definition,live),
            powerSpent:this.powerSpent(id,r.id),
            results: r.results ? JSON.parse(r.results) : null,
            bets: tickets,
            bet: tickets[0] ? { car: tickets[0].car, stake: tickets[0].stake, payout: tickets[0].payout } : null,
          }
        : null,
    };
  }
  me(id) {
    return {
      user: this.profile(id),
      roomCode: this.membership(id),
      rules: RULES,
    };
  }
  history(id, {betsOnly=false}={}) {
    // Existing race snapshots and ledger entries are the durable source of truth.
    // Filter tickets before LIMIT so recent no-bet races cannot hide older bets.
    return this.all(
      `SELECT r.id,r.code,r.number,r.phase,r.starts,r.ends,r.entrants,r.results,
        CASE WHEN r.phase<>'results' AND EXISTS(SELECT 1 FROM live_races lr WHERE lr.race_id=r.id) THEN r.definition END AS live_definition,
        (SELECT COALESCE(SUM(l.delta),0) FROM ledger l WHERE l.user_id=? AND l.race_id=r.id) AS net_coins
       FROM races r
       WHERE ${betsOnly
         ? 'EXISTS(SELECT 1 FROM race_bets b WHERE b.race_id=r.id AND b.user_id=?) OR EXISTS(SELECT 1 FROM bets b WHERE b.race_id=r.id AND b.user_id=?)'
         : 'r.id IN (SELECT race_id FROM ledger WHERE user_id=? AND race_id IS NOT NULL) OR r.id=(SELECT id FROM races WHERE code=(SELECT code FROM members WHERE user_id=?) ORDER BY closes DESC LIMIT 1)'}
       ORDER BY r.closes DESC,r.rowid DESC LIMIT 50`,
      id, id, id,
    ).flatMap((r) => {
      const entrant = JSON.parse(r.entrants).find((e) => e.userId === id);
      const results = r.results ? JSON.parse(r.results) : [];
      const bets = this.ticketViews(r.id, id, results);
      if (!entrant && !bets.length) return [];
      const first = bets[0];
      const finish = results.find((e) => e.userId === id);
      return [{
        id: r.id,
        roomCode: r.code,
        number: r.number,
        phase: r.phase,
        starts: r.starts,
        ends: r.live_definition?r.starts+JSON.parse(r.live_definition).duration*1000:r.ends,
        ownCar: entrant?.car ?? null,
        place: finish?.place ?? null,
        prize: finish?.prize ?? 0,
        points: finish?.points ?? 0,
        winner: results[0]?.car ?? null,
        bets,
        bet: first ? {
          car: first.car,
          stake: first.stake,
          payout: first.payout,
          net: first.net,
          status: first.status,
        } : null,
        netCoins: r.net_coins,
        powerSpent:this.powerSpent(id,r.id),
      }];
    });
  }
  ledger(id) {
    return this.all(
      "SELECT delta,reason,race_id AS raceId,created FROM ledger WHERE user_id=? ORDER BY created DESC,rowid DESC LIMIT 30",
      id,
    );
  }
}
