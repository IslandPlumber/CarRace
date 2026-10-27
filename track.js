/** Shared course geometry: renderer and race sampling use the exact same path. */
export function circuitLength(track) {
  return 2 * (track.straight + track.shortStraight) + 2 * Math.PI * track.radius;
}
export function makeCircuit(overrides = {}) {
  const track = {type:'circuit',straight:88,shortStraight:30,radius:28,laneWidth:2.4,laps:1,...overrides};
  track.length = circuitLength(track) * track.laps;
  track.startOffset ??= track.straight * .82;
  return track;
}
export function trackPoint(track,distance,offset=0) {
  if (track.type==='straight') return {x:distance-track.length/2,z:offset,heading:0,section:'STRAIGHT',turn:0};
  const a=track.straight/2,b=track.shortStraight/2,r=track.radius;
  const perimeter=circuitLength(track);
  let s=((distance+(track.startOffset??track.straight*.82))%perimeter+perimeter)%perimeter;
  const arc=Math.PI*r/2;
  const pieces=[
    [track.straight,'HOME STRAIGHT',0,u=>[-a+u,b+r,1,0]],
    [arc,'TURN 1',1,u=>{const q=Math.PI/2-u/r;return[a+r*Math.cos(q),b+r*Math.sin(q),Math.sin(q),-Math.cos(q)];}],
    [track.shortStraight,'CLUBHOUSE STRAIGHT',0,u=>[a+r,b-u,0,-1]],
    [arc,'TURN 2',2,u=>{const q=-u/r;return[a+r*Math.cos(q),-b+r*Math.sin(q),Math.sin(q),-Math.cos(q)];}],
    [track.straight,'BACK STRAIGHT',0,u=>[a-u,-b-r,-1,0]],
    [arc,'TURN 3',3,u=>{const q=-Math.PI/2-u/r;return[-a+r*Math.cos(q),-b+r*Math.sin(q),Math.sin(q),-Math.cos(q)];}],
    [track.shortStraight,'FAR STRAIGHT',0,u=>[-a-r,-b+u,0,1]],
    [arc,'TURN 4',4,u=>{const q=Math.PI-u/r;return[-a+r*Math.cos(q),b+r*Math.sin(q),Math.sin(q),-Math.cos(q)];}],
  ];
  for (let i=0;i<pieces.length;i++) {
    const [length,section,turn,fn]=pieces[i];
    if (s<=length || i===pieces.length-1) {
      const [x,z,dx,dz]=fn(Math.min(s,length));
      return {x:x-dz*offset,z:z+dx*offset,heading:Math.atan2(dz,dx),section,turn};
    }
    s-=length;
  }
}
export function raceSection(race,distance) {
  if (race.track.type!=='circuit')return 'STRAIGHT';
  const remaining=race.track.length-distance;
  if (remaining<=0)return 'FINISH';
  if (remaining<race.track.startOffset)return 'HOME STRETCH';
  return trackPoint(race.track,distance).section;
}
