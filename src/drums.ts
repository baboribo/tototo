import { type Signal, STRIDE } from './signal';
export type DrumKind = 'kick'|'snare'|'hat'|'tom'|'cymbal';
export type DrumHit = { time:number; kind:DrumKind; strength:number; seed:number };

/** Timbral heuristics on an isolated percussion stem; labels are estimates. */
export function detectDrums(signal:Signal): DrumHit[] {
  const hits:DrumHit[]=[],last=[-1,-1,-1,-1,-1],baseline=[0,0,0,0,0];
  const kinds:DrumKind[]=['kick','tom','snare','hat','cymbal'];
  for(let frame=1;frame<signal.values.length/STRIDE;frame++) {
    const p=frame*STRIDE,time=frame/signal.rate;
    const bands=Array.from(signal.values.subarray(p,p+5));
    const strongest=Math.max(...bands,0.001);
    for(let b=0;b<5;b++) {
      const rise=bands[b]-baseline[b];baseline[b]+=(bands[b]-baseline[b])*0.12;
      const refractory=b===3?0.07:0.11;
      const attack=bands[b]-signal.values[p-STRIDE+b];
      if(bands[b]<0.16||bands[b]<strongest*0.35||rise<0.1||attack<0.035||time-last[b]<refractory)continue;
      // Low-mid duplicates under a dominant kick and air duplicates under hats
      // are suppressed; distinct overlapping low/high hits remain possible.
      if(b===1&&bands[0]>bands[1]*1.3)continue;
      if(b===4&&bands[4]<bands[3]*0.95)continue;
      last[b]=time;
      hits.push({time,kind:kinds[b],strength:Math.min(1,rise*2.5),seed:(Math.round(time*1000)*2654435761+b*1013904223)>>>0});
    }
  }
  return hits.sort((a,b)=>a.time-b.time);
}

export function recentHits(hits:DrumHit[],time:number,tail=0.32,limit=20) {
  let lo=0,hi=hits.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(hits[mid].time<=time)lo=mid+1;else hi=mid;}
  const result:DrumHit[]=[];
  for(let i=lo-1;i>=0&&hits[i].time>time-tail&&result.length<limit;i--)result.push(hits[i]);
  return result;
}

export function hitPosition(hit:DrumHit) {
  let seed=hit.seed;
  const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296;};
  // The reference's central 4×4 grid is fixed; only the selected cell is random.
  return {x:130+Math.floor(random()*4)*15,y:90+Math.floor(random()*4)*15};
}
