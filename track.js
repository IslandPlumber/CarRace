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
/** New rounds use the speedway. Older saved circuits keep their exact geometry. */
export function makeSpeedway(overrides = {}) {
  return makeCircuit({profile:'speedway-v1',name:'StreakChat Motor Speedway',straight:650,shortStraight:40,radius:170,
    startOffset:325,banking:{turnDegrees:24,straightDegrees:4,transition:110,width:24,apron:9},...overrides});
}
const smoother = x => {const t=Math.max(0,Math.min(1,x));return t*t*t*(t*(t*6-15)+10);};
function bankAt(track,piece,u) {
  if(!track.banking)return 0;
  const b=track.banking;
  const blend=piece===0||piece===4?1-smoother(Math.min(u,track.straight-u)/b.transition):1;
  return (b.straightDegrees+(b.turnDegrees-b.straightDegrees)*blend)*Math.PI/180;
}
export function trackPoint(track,distance,offset=0) {
  if (track.type==='straight') return {x:distance-track.length/2,y:0,z:offset,heading:0,bank:0,section:'STRAIGHT',turn:0};
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
      const bank=bankAt(track,i,Math.min(s,length)),half=(track.banking?.width??24)/2;
      const y=track.banking?Math.max(0,Math.min(offset+half,half*2))*Math.tan(bank):0;
      return {x:x-dz*offset,y,z:z+dx*offset,heading:Math.atan2(dz,dx),bank:offset>=-half&&offset<=half?bank:0,section,turn};
    }
    s-=length;
  }
}
/** An orthonormal road frame, including longitudinal transition pitch. */
export function trackFrame(track,distance,offset=0) {
  const p=trackPoint(track,distance,offset),a=trackPoint(track,distance-.04,offset),b=trackPoint(track,distance+.04,offset);
  const normalize=v=>{const n=Math.hypot(...v);return v.map(x=>x/n);};
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const forward=normalize([b.x-a.x,b.y-a.y,b.z-a.z]);
  const lateral=[-Math.sin(p.heading),Math.tan(p.bank),Math.cos(p.heading)];
  const up=normalize(cross(lateral,forward)),right=normalize(cross(forward,up));
  return {...p,forward,up,right};
}
export function raceSection(race,distance) {
  if (race.track.type!=='circuit')return 'STRAIGHT';
  const remaining=race.track.length-distance;
  if (remaining<=0)return 'FINISH';
  if (remaining<race.track.startOffset)return 'HOME STRETCH';
  return trackPoint(race.track,distance).section;
}
