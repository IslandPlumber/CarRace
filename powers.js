/** Shared descriptions and replay queries. Only the server applies race effects. */
export const POWERS = Object.freeze({
 ironhart:{name:'Bump & Run',icon:'BUMP',color:'#dfe4eb',effect:'bumper',description:'A hard charge unsettles up to three nearby rivals while the black car powers through.',boost:.08,duration:2.8,slow:.18,hitDuration:1.6,radius:16,targets:3},
 candy:{name:'Sugar Rush',icon:'RUSH',color:'#b4f64c',effect:'nitro',description:'Unleash a huge straight-line burst from the candy-green stock car.',boost:.24,duration:2.8},
 seven:{name:'Seven-Time Surge',icon:'SEVEN',color:'#5d8eff',effect:'precision',description:'The cobalt-blue machine finds its rhythm and holds a long, clean burst of speed.',boost:.20,duration:3},
 crown:{name:"King's Command",icon:'CROWN',color:'#5ed8ef',effect:'pressure',description:'Put the leader under royal pressure, cutting their speed while the blue No. 43 advances.',boost:.10,duration:2.8,slow:.45,hitDuration:4.2,shock:.40,targeting:'leader'},
 junior:{name:'Family Draft',icon:'DRAFT',color:'#ff5b59',effect:'draft',description:'The red No. 88 punches a hole in the air. Boost yourself and pull the last-place car into your draft.',boost:.14,duration:3.5,assist:.10,hitDuration:2.2},
 prism:{name:'Prism Break',icon:'PRISM',color:'#c68bff',effect:'pressure',description:'The rainbow car overwhelms the leader with a sudden attack, then shoots past in a blaze of color.',boost:.12,duration:2.8,slow:.55,hitDuration:3.4,shock:.60,targeting:'leader'},
 smoke:{name:'Smoke Screen',icon:'SMOKE',color:'#ff943e',effect:'smoke',description:'Leave a cloud behind the orange No. 20, slowing up to three nearby rivals while you charge away.',boost:.12,duration:3.5,slow:.10,hitDuration:2,radius:16,targets:3},
});
export const SPECIAL_POWERS = Object.freeze(Object.fromEntries(Object.entries(POWERS).map(([id,p])=>[id,{...p,...({
 ironhart:{boost:.28,duration:5.5,slow:.45,hitDuration:4,radius:26,shock:.25},
 candy:{boost:.65,duration:6.5},seven:{boost:.55,duration:7},
 crown:{boost:.28,duration:5,slow:.68,hitDuration:6.5,shock:.70},
 junior:{boost:.42,duration:7,assist:.30,hitDuration:5.5},
 prism:{boost:.30,duration:5,slow:.72,hitDuration:5.5,shock:.80},
 smoke:{boost:.30,duration:6,slow:.45,hitDuration:5,radius:26},
}[id])}])));
export const SPECIAL_POWER_POLICY = Object.freeze({version:1,uses:1,baseCost:75,minCost:50,discountPerLevel:5});
export const specialPowerCost = levels => Math.max(50,75-5*Math.min(5,Math.max(0,levels?.powerReserve??0)));
export const powerForRace = (race,id) => (race?.simulation?.specials?SPECIAL_POWERS:POWERS)[id];

export function powerEvents(race) { return race?.events?.filter(e => e.power) ?? []; }
export function activePowerEffects(race, id, time) {
  return powerEvents(race).flatMap(event => {
    const effects = [];
    if (event.actor === id && time >= event.time && time < event.time + event.duration)
      effects.push({event, kind: 'boost'});
    if (event.targets.includes(id) && time >= event.hitTime && time < (event.targetEnds?.[id]??event.hitTime + event.hitDuration))
      effects.push({event, kind: event.assist ? 'assist' : 'slow'});
    return effects;
  });
}

export function powerStatus(race, id, time, finished=false) {
  if (!race?.simulation?.powers) return '';
  if(finished)return `${POWERS[id].name} · finished`;
  const active = activePowerEffects(race, id, time);
  const impact = active.find(e => e.kind === 'slow' && e.event.impact);
  if (impact) return `${impact.event.actor === 'prism' ? 'BONK!' : 'Under pressure!'} · Regaining speed`;
  const own = active.find(e => e.kind === 'boost');
  if (own) return `${POWERS[id].name} · active`;
  const hit = active.find(e => e.kind !== 'boost');
  if (hit) return hit.kind === 'assist' ? 'Draft boost!' : `${POWERS[hit.event.actor].name} · slowed`;
  const moves=powerEvents(race).filter(e=>e.actor===id),used=moves.filter(e=>time>=e.time).length;
  const charges=race.simulation.specials?1:(race.cast.find(r=>r.id===id)?.upgrades?.powerReserve??0)>=5?2:1;
  const latest=moves.filter(e=>time>=e.time).at(-1);
  const cooling=race.simulation.manualPowers&&used<charges&&latest&&time<latest.time+Math.max(latest.duration,race.simulation.cooldown??4);
  return `${POWERS[id].name} · ${cooling?'recharging':used&&used<charges?'reserve ready':used?'used':'ready'}`;
}

/** Pure replay-time reaction; seeking never leaves a car tilted or airborne. */
export function hitReaction(race, id, time) {
  const hit = activePowerEffects(race,id,time).find(e=>e.kind==='slow'&&e.event.impact);
  if(!hit)return {roll:0,lift:0};
  const t=time-hit.event.hitTime,big=Boolean(hit.event.spectacle),decay=Math.exp(-t*(big?1.1:2.5));
  return {roll:Math.sin(t*19)*(big?.35:.15)*decay,lift:Math.abs(Math.sin(t*13))*(big?.45:.22)*decay};
}
