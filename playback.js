const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

/** Play confirmed history on a monotonic clock. Network arrivals never seek the cars. */
export class LivePlayback {
  constructor(){this.reset();}
  reset(){this.id=null;this.time=0;this.now=null;this.head=0;this.delay=1.8;this.receivedAt=0;}
  read(race,serverNow,now){
    const def=race.definition;
    if(!def)return 0;
    const head=def.availableTime??def.duration,elapsed=Math.max(0,(serverNow-race.starts)/1000);
    if(this.id!==race.id){
      this.id=race.id;this.head=head;this.delay=1.8;this.now=now;this.receivedAt=now;
      this.time=def.completed?head:clamp(elapsed-this.delay,0,head);
      return this.time;
    }
    const dt=clamp((now-this.now)/1000,0,.1);this.now=now;
    if(head>this.head){
      // Leave enough history for the observed update spacing, including quantization.
      const needed=clamp(head-this.head+.45,1.8,4);
      this.delay=Math.max(needed,this.delay-Math.max(0,(now-this.receivedAt)/1000)*.02);this.receivedAt=now;this.head=head;
    }
    const target=clamp(elapsed-this.delay,0,this.head);
    let rate=clamp(1+(target-this.time)*.3,.85,1.12);
    // Ease down if an update is late; never predict unpublished motion or rewind.
    if(!def.completed)rate=Math.min(rate,Math.max(0,(this.head-this.time)/.4));
    this.time=Math.min(this.head,this.time+dt*rate);
    return this.time;
  }
}

/** Cache finish crossings per snapshot instead of scanning every path every frame. */
const finishCache=new WeakMap();
export function finishTimes(def){
  if(finishCache.has(def))return finishCache.get(def);
  const result=new Map(def.cast.map(r=>{
    let finish=Infinity;
    for(let i=1;i<r.progress.length;i++){
      const a=r.progress[i-1],b=r.progress[i];
      if(a.distance<def.track.length&&b.distance>=def.track.length){finish=a.time+(def.track.length-a.distance)*(b.time-a.time)/(b.distance-a.distance);break;}
    }
    return[r.id,finish];
  }));
  finishCache.set(def,result);return result;
}
