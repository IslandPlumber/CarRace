import {makeCircuit,circuitLength,trackPoint} from './track.js';
/**
 * Data-driven straight and circuit race playback. No meshes, clocks or rendering state
 * are stored here: the same definition always yields the same race state.
 */
export const ACTOR_IDS = Object.freeze([
  "ironhart", "seven", "crown", "junior", "candy", "prism", "smoke",
]);

const NAMES = Object.freeze({
  ironhart: "Duke Ironhart", seven: "Miles Seven", crown: "Ricky Crown", junior: "Redline Junior",
  candy: "Rowdy Candy", prism: "Jett Prism", smoke: "Troy Smoke",
});

function insist(condition, message) {
  if (!condition) throw new Error(`Invalid race: ${message}`);
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function nonempty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function crossingTime(runner, length) {
  for (let i = 1; i < runner.progress.length; i += 1) {
    const a = runner.progress[i - 1], b = runner.progress[i];
    if (a.distance < length && b.distance >= length) {
      if (b.distance === length) return b.time;
      return a.time + (length - a.distance) * (b.time - a.time) / (b.distance - a.distance);
    }
  }
  return Infinity;
}

/** Validate a definition, throwing a useful error. The input is not modified. */
export function validateRace(race) {
  insist(race && typeof race === "object" && !Array.isArray(race), "expected an object");
  insist(race.version === 1, "version must be 1");
  insist(nonempty(race.id) && race.id.length <= 100, "id must be a nonempty string of at most 100 characters");
  insist(nonempty(race.title) && race.title.length <= 200, "title must be a nonempty string of at most 200 characters");
  insist(typeof race.seed === "string" || finite(race.seed), "seed must be a string or finite number");
  insist(finite(race.duration) && race.duration > 0, "duration must be positive");
  const live = race.live === true;
  if (live) {
    insist(typeof race.completed === "boolean", "live completion flag must be boolean");
    insist(finite(race.availableTime) && race.availableTime >= 0 && race.availableTime <= race.duration, "invalid live history boundary");
    insist(race.seed === "live", "live race must not expose its private seed");
  }
  insist(race.track && ['straight','circuit'].includes(race.track.type), 'track must be straight or circuit');
  if(race.track.type==='circuit') {
    const t=race.track;
    insist([t.straight,t.shortStraight,t.radius].every(v=>finite(v)&&v>0), 'circuit dimensions must be positive');
    insist(Number.isInteger(t.laps)&&t.laps>=1&&t.laps<=5, 'circuit laps must be 1–5');
    insist(finite(t.startOffset)&&t.startOffset>=0&&t.startOffset<t.straight,'invalid starting gate offset');
    insist(Math.abs(t.length-circuitLength(t)*t.laps)<.01,'circuit length must match its geometry');
    insist(t.radius > race.cast?.length*t.laneWidth/2+3,'circuit radius too small for field width');
    if(t.banking){const b=t.banking;
      insist([b.turnDegrees,b.straightDegrees,b.transition,b.width,b.apron].every(finite),'banking values must be finite');
      insist(b.turnDegrees>=0&&b.turnDegrees<=40&&b.straightDegrees>=0&&b.straightDegrees<=b.turnDegrees,'invalid banking angle');
      insist(b.transition>0&&b.transition<=t.straight/2&&b.width>=race.cast.length*t.laneWidth&&b.width<t.radius&&b.apron>0,'invalid banked road dimensions');
    }
  }
  insist(race.startDelay===undefined || (finite(race.startDelay)&&race.startDelay>=0&&race.startDelay<race.duration),'invalid gate delay');
  insist(finite(race.track.length) && race.track.length > 0, "track.length must be positive");
  insist(finite(race.track.laneWidth) && race.track.laneWidth > 0, "track.laneWidth must be positive");
  insist(Array.isArray(race.cast) && race.cast.length >= 1 && race.cast.length <= ACTOR_IDS.length,
    `cast must contain 1–${ACTOR_IDS.length} drivers`);
  const ids = new Set(), lanes = new Set(), finishTimes = new Map();
  for (const runner of race.cast) {
    insist(runner && ACTOR_IDS.includes(runner.id), `unknown driver ${runner?.id}`);
    insist(!ids.has(runner.id), `duplicate driver ${runner.id}`);
    ids.add(runner.id);
    insist(Number.isInteger(runner.lane) && runner.lane >= 0 && runner.lane < race.cast.length,
      `${runner.id}: lane must be an integer within the selected field`);
    insist(!lanes.has(runner.lane), `duplicate lane ${runner.lane}`);
    lanes.add(runner.lane);
    insist(Array.isArray(runner.progress) && runner.progress.length >= (live ? 1 : 2),
      `${runner.id}: at least two progress keyframes are required`);
    for (let i = 0; i < runner.progress.length; i += 1) {
      const p = runner.progress[i];
      insist(p && finite(p.time) && p.time >= 0 && p.time <= race.duration,
        `${runner.id}: keyframe time must be within the race`);
      insist(finite(p.distance) && p.distance >= 0,
        `${runner.id}: keyframe distance must be finite and nonnegative`);
      if (i > 0) {
        const previous = runner.progress[i - 1];
        insist(p.time > previous.time, `${runner.id}: keyframe times must increase`);
        insist(p.distance >= previous.distance, `${runner.id}: progress cannot move backwards`);
      }
    }
    const first = runner.progress[0], last = runner.progress.at(-1);
    insist(first.time === 0 && first.distance === 0, `${runner.id}: must start at time 0 and distance 0`);
    insist(last.time === (live ? race.availableTime : race.duration), `${runner.id}: final keyframe must equal the available history boundary`);
    const finishTime = crossingTime(runner, race.track.length);
    if (!live || race.completed) insist(finishTime < race.duration, `${runner.id}: must cross the finish before the race ends`);
    if(race.startDelay)insist(runner.progress.filter(p=>p.time<=race.startDelay).every(p=>p.distance===0),`${runner.id}: movement before gate release`);
    finishTimes.set(runner.id, finishTime);
  }
  if (live && !race.completed) insist(Array.isArray(race.outcome) && race.outcome.length === 0, "unfinished live race cannot expose an outcome");
  else insist(Array.isArray(race.outcome) && race.outcome.length === ids.size &&
    new Set(race.outcome).size === ids.size && race.outcome.every(id => ids.has(id)),
  "outcome must list every selected driver exactly once");
  // The declared result is a check on the timeline, never a substitute for it.
  for (let i = 1; i < race.outcome.length; i += 1) {
    insist(finishTimes.get(race.outcome[i - 1]) < finishTimes.get(race.outcome[i]),
      "outcome must match distinct actual finish-crossing times");
  }
  insist(Array.isArray(race.events), "events must be an array");
  const eventIds = new Set();
  for (const event of race.events) {
    insist(event && nonempty(event.id) && !eventIds.has(event.id), "event ids must be nonempty and unique");
    eventIds.add(event.id);
    insist(event.type === "caption", "version 1 supports caption events only");
    insist(finite(event.time) && event.time >= 0 && event.time < race.duration,
      `${event.id}: event time must be within the race`);
    if (live) insist(event.time <= race.availableTime, "live event cannot reveal a future activation");
    insist(finite(event.duration) && event.duration > 0 && event.time + event.duration <= race.duration + 1e-8,
      `${event.id}: event duration must be positive and finish within the race`);
    insist(nonempty(event.text) && event.text.length <= 500, `${event.id}: caption must contain 1–500 characters`);
    if (event.power !== undefined) {
      insist(['bumper','nitro','precision','pressure','draft','smoke'].includes(event.power), 'unknown power effect');
      insist(ids.has(event.actor), 'power actor must be in the race');
      insist(Array.isArray(event.targets) && event.targets.length <= 3 &&
        new Set(event.targets).size === event.targets.length &&
        event.targets.every(id => ids.has(id) && id !== event.actor), 'invalid power targets');
      insist(finite(event.hitTime) && event.hitTime >= event.time && event.hitTime < race.duration &&
        finite(event.hitDuration) && event.hitDuration >= 0 &&
        event.hitTime + event.hitDuration <= race.duration, 'invalid power impact window');
      insist(typeof event.assist === 'boolean', 'power assist flag must be boolean');
    }
  }
  return race;
}

function distanceAt(progress, time) {
  if (time <= 0) return progress[0].distance;
  for (let i = 1; i < progress.length; i += 1) {
    const b = progress[i];
    if (time <= b.time) {
      const a = progress[i - 1], u = (time - a.time) / (b.time - a.time);
      return a.distance + (b.distance - a.distance) * u;
    }
  }
  return progress.at(-1).distance;
}

/**
 * Resolve a race at an absolute time, including when seeking backwards.
 * Distances interpolate between keyframes; the shared course maps each distance
 * and lane into world position/heading. Finish rank is based on crossing time.
 */
export function sampleRace(race, time) {
  validateRace(race);
  insist(finite(time), "sample time must be finite");
  const t = Math.max(0, Math.min(race.live ? race.availableTime : race.duration, time));
  const runners = race.cast.map(runner => {
    const distance = distanceAt(runner.progress, t);
    const finishTime = crossingTime(runner, race.track.length);
    return {
      id: runner.id, lane: runner.lane, distance,
      ...trackPoint(race.track,distance,(runner.lane-(race.cast.length-1)/2)*race.track.laneWidth),
      finishTime, finished: t >= finishTime,
    };
  });
  const ordered = [...runners].sort((a, b) => {
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    return b.distance - a.distance || a.lane - b.lane;
  });
  const ranks = new Map(ordered.map((runner, index) => [runner.id, index + 1]));
  for (const runner of runners) runner.rank = ranks.get(runner.id);
  return {
    time: t, runners,
    events: race.events.filter(event => t >= event.time && t < event.time + event.duration)
      .map(event => ({...event})),
    standings: ordered.map(runner => runner.id),
  };
}

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function randomSource(seed) {
  let state = hash(seed);
  return () => {
    let t = state += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function shuffled(values, random) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const rounded = value => Math.round(value * 1e6) / 1e6;

/**
 * Construct a repeatable race from reusable driver IDs. This is a small scripted
 * scenario generator, not a physics simulation. A given seed and options always
 * produce the same cast, lane assignments, timeline, captions and finish order.
 */
export function generateRace(seed, options = {}) {
  insist(typeof seed === "string" || finite(seed), "seed must be a string or finite number");
  insist(options && typeof options === "object" && !Array.isArray(options), "generator options must be an object");
  const ids = options.cast === undefined ? [...ACTOR_IDS] : options.cast;
  insist(Array.isArray(ids) && ids.length >= 1 && ids.length <= ACTOR_IDS.length &&
    ids.every(id => ACTOR_IDS.includes(id)) && new Set(ids).size === ids.length,
  "generator cast must be a unique list of known driver ids");
  const duration = options.duration ?? 64;
  insist(finite(duration) && duration >= 2 && duration <= 120, "generated duration must be 2–120 seconds");
  const track = options.track?.type==='straight' ? {type:'straight',length:80,laneWidth:2.4,...options.track} : makeCircuit(options.track??{});
  insist(['straight','circuit'].includes(track.type) && finite(track.length) && track.length>0 && finite(track.laneWidth)&&track.laneWidth>0,'generator requires a valid track');
  const startDelay = track.type==='circuit' ? Math.min(7,duration*.14) : 0;
  const raceTime = duration-startDelay;
  const at = f=>rounded(startDelay+raceTime*f);
  insist(options.winner === undefined || ids.includes(options.winner), "generator winner must be in the selected cast");
  const seedKey = `${typeof seed}:${seed}`;
  const random = randomSource(seedKey);
  const outcome = shuffled(ids, random);
  if (options.winner !== undefined) {
    outcome.splice(outcome.indexOf(options.winner), 1);
    outcome.unshift(options.winner);
  }
  const lanes = shuffled(ids, random);
  const finishTimes = new Map(outcome.map((id, place) => [id,
    at(.88 + (track.type==='circuit'?.04:.08) * place / Math.max(1, ids.length - 1))]));
  const intermediate=shuffled(ids.filter(id=>id!==outcome[0]&&id!==outcome.at(-1)),random);
  const leaders=[outcome.at(-1),...intermediate.slice(0,3),outcome[0]];
  const beats=[.12,.27,.43,.60,.75];
  const packProgress=ids.map(id=>beats.map((f,i)=>{
    const leader=i===4?outcome[0]:(leaders[i]??outcome[i%outcome.length]);
    const base=[.105,.25,.41,.58,.74][i];
    return {time:at(f),distance:rounded(track.length*(base+(id===leader?.008:-.001-random()*.008)))};
  }));
  const cast = ids.map((id,actorIndex) => {
    const place = outcome.indexOf(id), spread = place / Math.max(1, ids.length - 1);
    const earlyLeader = ids.length > 1 && place === ids.length - 1;
    const first = ids.length === 1 ? .14 : earlyLeader ? .24 : .10 + .08 * spread + random() * .008;
    const middle = ids.length === 1 ? .42 : earlyLeader ? .50 : .33 + .13 * spread + random() * .008;
    const late = place === 0 ? .69 : .61 + .065 * (1 - spread) + random() * .008;
    const finishTime = finishTimes.get(id);
    return {
      id, lane: lanes.indexOf(id),
      progress: track.type==='circuit' ? [
        {time:0,distance:0},{time:startDelay,distance:0},...packProgress[actorIndex],
        {time:finishTime,distance:track.length},
        {time:duration,distance:rounded(track.length+(duration-finishTime)*track.length/duration*.65)}
      ] : [
        {time: 0, distance: 0},
        ...(startDelay?[{time:startDelay,distance:0}]:[]),
        {time: at(.18), distance: rounded(track.length * first)},
        {time: at(.40), distance: rounded(track.length * middle)},
        {time: at(.62), distance: rounded(track.length * late)},
        {time: finishTime, distance: track.length},
        {time: duration, distance: rounded(track.length + (duration - finishTime) * track.length / duration * .65)},
      ],
    };
  });
  const signature = JSON.stringify({seed: seedKey, ids, duration, track, winner: options.winner});
  const winner = outcome[0], early = outcome.at(-1);
  const race = {
    version: 1, id: `race-${hash(signature).toString(16).padStart(8, "0")}`,
    title: options.title ?? `${NAMES[winner]}'s circuit challenge`, seed, duration, startDelay, track, cast,
    events: [
      ...(startDelay?[{id:'gate',type:'caption',time:0,duration:startDelay,text:'Under starter’s orders…'}]:[]),
      {id:'start',type:'caption',time:startDelay,duration:rounded(duration*.05),text:'The gates are open!'},
      {id: "early-leader", type: "caption", time: at(.18), duration: rounded(duration * .10),
        text: `${NAMES[early]} takes the early lead.`},
      {id: "late-charge", type: "caption", time: at(.76), duration: rounded(duration * .07),
        text: `${NAMES[winner]} makes a late charge!`},
      {id: "winner", type: "caption", time: finishTimes.get(winner), duration: rounded(duration * .08),
        text: `${NAMES[winner]} crosses first!`},
    ],
    outcome,
  };
  return validateRace(race);
}
