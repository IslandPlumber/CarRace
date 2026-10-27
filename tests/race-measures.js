/** Derive the finish from the simulated distance timeline, not the outcome list. */
export function finishTime(race,runner){
 for(let i=1;i<runner.progress.length;i++){
  const a=runner.progress[i-1],b=runner.progress[i];
  if(a.distance<race.track.length&&b.distance>=race.track.length)
   return a.time+(race.track.length-a.distance)*(b.time-a.time)/(b.distance-a.distance);
 }
 return race.duration;
}
