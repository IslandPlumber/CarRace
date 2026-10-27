import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {ACTOR_IDS, generateRace as generateDefaultRace, sampleRace, validateRace} from "./race-core.js";

const generateRace=(seed,options={})=>generateDefaultRace(seed,{duration:12,...options,track:{type:'straight',...options.track}});
const clone = value => structuredClone(value);
const byId = (state, id) => state.runners.find(runner => runner.id === id);

function fixture() {
  return {
    version: 1, id: "known-timeline", title: "Known overtake", seed: 1, duration: 10,
    track: {type: "straight", length: 80, laneWidth: 2.4},
    cast: [
      {id: "candy", lane: 1, progress: [
        {time: 0, distance: 0}, {time: 4, distance: 20},
        {time: 8, distance: 80}, {time: 10, distance: 90},
      ]},
      {id: "smoke", lane: 0, progress: [
        {time: 0, distance: 0}, {time: 4, distance: 40},
        {time: 9, distance: 80}, {time: 10, distance: 85},
      ]},
    ],
    events: [{id: "charge", type: "caption", time: 4, duration: 2, text: "Rowdy Candy attacks!"}],
    outcome: ["candy", "smoke"],
  };
}

test("known progress interpolates distance and maps to track/lane coordinates", () => {
  const race = fixture();
  const state = sampleRace(race, 2);
  assert.equal(state.time, 2);
  assert.deepEqual(state.standings, ["smoke", "candy"]);
  const candy = byId(state, "candy"), smoke = byId(state, "smoke");
  assert.equal(candy.distance, 10);
  assert.equal(candy.x, -30);
  assert.equal(candy.z, 1.2);
  assert.equal(smoke.z, -1.2);
  assert.equal(candy.heading, 0);
  assert.equal(candy.rank, 2);
  assert.equal(candy.finished, false);
});

test("overtakes are produced by the timeline, with finish order from crossings", () => {
  const race = fixture();
  assert.equal(sampleRace(race, 4).standings[0], "smoke");
  assert.equal(sampleRace(race, 7).standings[0], "candy");
  assert.equal(byId(sampleRace(race, 8), "candy").finished, true);
  assert.equal(byId(sampleRace(race, 8), "smoke").finished, false);
  assert.deepEqual(sampleRace(race, 10).standings, race.outcome);
});

test("a finish crossing between keyframes is timed by interpolation", () => {
  const race = fixture();
  race.cast[0].progress = [{time: 0, distance: 0}, {time: 10, distance: 100}];
  assert.equal(byId(sampleRace(race, 8), "candy").finishTime, 8);
  assert.equal(byId(sampleRace(race, 8), "candy").finished, true);
});

test("a later sprint after the finish cannot rewrite finishing order", () => {
  const race = fixture();
  race.cast[1].progress.at(-1).distance = 150;
  const state = sampleRace(race, 10);
  assert.ok(byId(state, "smoke").distance > byId(state, "candy").distance);
  assert.deepEqual(state.standings, ["candy", "smoke"]);
});

test("seeking backwards resets captions and finished state without mutation", () => {
  const race = fixture(), original = clone(race);
  assert.equal(validateRace(race), race);
  assert.equal(sampleRace(race, 5).events[0].text, "Rowdy Candy attacks!");
  assert.deepEqual(sampleRace(race, 6).events, []);
  assert.equal(sampleRace(race, 10).runners.every(runner => runner.finished), true);
  const beginning = sampleRace(race, 0);
  assert.equal(beginning.runners.some(runner => runner.finished), false);
  assert.deepEqual(beginning.events, []);
  assert.deepEqual(race, original);
});

test("sampling clamps negative and late times but rejects nonfinite times", () => {
  const race = fixture();
  assert.equal(sampleRace(race, -5).time, 0);
  assert.equal(sampleRace(race, 99).time, 10);
  for (const time of [NaN, Infinity, "2", undefined]) {
    assert.throws(() => sampleRace(race, time), /sample time/);
  }
});

test("validation rejects bad actors, duplicate identities and colliding lanes", () => {
  for (const [change, pattern] of [
    [r => {r.cast[0].id = "not-a-driver";}, /unknown driver/],
    [r => {r.cast[1].id = "candy";}, /duplicate driver/],
    [r => {r.cast[1].lane = 1;}, /duplicate lane/],
    [r => {r.cast[1].lane = -1;}, /lane/],
    [r => {r.cast[1].lane = 2;}, /lane/],
    [r => {r.cast[1].lane = .5;}, /lane/],
  ]) {
    const race = fixture(); change(race);
    assert.throws(() => validateRace(race), pattern);
  }
});

test("validation rejects impossible or incomplete timelines", () => {
  for (const [change, pattern] of [
    [r => {r.cast[0].progress[1].time = 0;}, /times must increase/],
    [r => {r.cast[0].progress[2].distance = 10;}, /backwards/],
    [r => {r.cast[0].progress[0].distance = 1;}, /must start/],
    [r => {r.cast[0].progress[0].time = 1;}, /must start/],
    [r => {r.cast[0].progress.at(-1).time = 9;}, /final keyframe/],
    [r => {r.cast[0].progress.at(-1).time = 11;}, /within the race/],
    [r => {r.cast[0].progress[2].distance = 70; r.cast[0].progress.at(-1).distance = 75;}, /must cross/],
    [r => {r.cast[0].progress[2].distance = 70; r.cast[0].progress.at(-1).distance = 80;}, /must cross/],
    [r => {r.cast[0].progress[1].distance = NaN;}, /finite/],
  ]) {
    const race = fixture(); change(race);
    assert.throws(() => validateRace(race), pattern);
  }
});

test("declared outcomes must match actual finish order and include the cast", () => {
  for (const outcome of [["smoke", "candy"], ["candy"], ["candy", "candy"], ["candy", "ironhart"]]) {
    const race = fixture(); race.outcome = outcome;
    assert.throws(() => validateRace(race), /outcome/);
  }
  const tied = fixture();
  tied.cast[1].progress[2].time = 8;
  assert.throws(() => validateRace(tied), /distinct actual/);
});

test("unsupported tracks, invalid dimensions and out-of-bounds events fail", () => {
  for (const [change, pattern] of [
    [r => {r.track.type = "oval";}, /track/],
    [r => {r.track.length = 0;}, /track.length/],
    [r => {r.track.laneWidth = Infinity;}, /track.laneWidth/],
    [r => {r.events[0].duration = 7;}, /duration/],
    [r => {r.events[0].time = -1;}, /event time/],
    [r => {r.events[0].text = "";}, /caption/],
    [r => {r.events[0].type = "throw-hat";}, /caption events only/],
    [r => {r.events.push({...r.events[0]});}, /event ids/],
  ]) {
    const race = fixture(); change(race);
    assert.throws(() => validateRace(race), pattern);
  }
});

test("seeds reproduce complete race definitions without modifying options", () => {
  const options = {cast: ["candy", "smoke", "prism"], winner: "smoke", track: {length: 100}};
  const original = clone(options);
  assert.deepEqual(generateRace(42, options), generateRace(42, options));
  assert.deepEqual(options, original);
  assert.notDeepEqual(generateRace(42), generateRace(43));
  assert.notDeepEqual(generateRace("42"), generateRace(42));
});

test("generated cast, lane assignments, track dimensions and winner are honored", () => {
  const race = generateRace("custom", {
    cast: ["smoke", "prism", "junior", "ironhart", "seven"],
    winner: "smoke", duration: 14, track: {length: 100, laneWidth: 2.6},
  });
  assert.equal(race.cast.length, 5);
  assert.equal(race.duration, 14);
  assert.equal(race.track.length, 100);
  assert.equal(race.track.laneWidth, 2.6);
  assert.deepEqual([...new Set(race.cast.map(r => r.lane))].sort(), [0,1,2,3,4]);
  assert.equal(race.outcome[0], "smoke");
  assert.equal(sampleRace(race, 14).standings[0], "smoke");
  assert.ok(sampleRace(race, 14).runners.every(r => r.finished));
});

test("a range of generated races have real overtakes and all drivers finish", () => {
  for (let seed = 0; seed < 100; seed += 1) {
    const race = generateRace(seed);
    const early = sampleRace(race, race.duration * .18), late = sampleRace(race, race.duration * .62);
    assert.notEqual(early.standings[0], late.standings[0]);
    assert.equal(late.standings[0], race.outcome[0]);
    const final = sampleRace(race, race.duration);
    assert.deepEqual(final.standings, race.outcome);
    assert.ok(final.runners.every(r => r.finished && r.finishTime < race.duration));
    for (const runner of final.runners) assert.ok(Math.abs(runner.z) <= 3 * race.track.laneWidth);
  }
});

test("a one-driver custom field is valid and centered", () => {
  const race = generateRace("solo", {cast: ["smoke"]});
  assert.equal(sampleRace(race, 6).runners[0].z, 0);
  assert.deepEqual(race.outcome, ["smoke"]);
});

test("invalid generator inputs fail clearly", () => {
  for (const [seed, options, pattern] of [
    [NaN, {}, /seed/], [1, {cast: []}, /cast/],
    [1, {cast: ["candy", "candy"]}, /cast/], [1, {cast: ["unknown"]}, /cast/],
    [1, {cast: ["smoke"], winner: "candy"}, /winner/],
    [1, {duration: 1}, /duration/], [1, {track: {type: "oval"}}, /track/],
  ]) assert.throws(() => generateRace(seed, options), pattern);
});

test("bundled examples demonstrate different casts, tracks and outcomes", async () => {
  const a = validateRace(generateRace('stock-car-a',{winner:'ironhart'})), b = validateRace(generateRace('stock-car-b',{cast:ACTOR_IDS.slice(0,5),winner:'candy',track:{length:100}}));
  assert.equal(a.cast.length, ACTOR_IDS.length);
  assert.equal(b.cast.length, 5);
  assert.notEqual(a.track.length, b.track.length);
  assert.notEqual(a.outcome[0], b.outcome[0]);
  for (const race of [a,b]) {
    assert.deepEqual(sampleRace(race, race.duration).standings, race.outcome);
    assert.notEqual(sampleRace(race, race.duration * .18).standings[0], sampleRace(race, race.duration * .62).standings[0]);
  }
});
