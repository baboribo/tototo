import type {Signal} from './signal';
import type {DrumHit,DrumKind} from './drums';
export type Channel={kind:DrumKind;low:number;high:number;gain:number;threshold:number;attack:number;gap:number;enabled:boolean};
export const defaults=():Channel[]=>[
  ['kick',40,180],['snare',500,2500],['hat',4000,10000],['tom',180,500],['cymbal',9000,18000]
].map(([kind,low,high])=>({kind:kind as DrumKind,low:Number(low),high:Number(high),gain:0,threshold:0.16,attack:0.035,gap:kind==='hat'?70:110,enabled:true}));
export function channelLevels(signal:Signal,c:Channel){
  const s=signal.spectrum;if(!s)return new Float32Array();
  const count=s.values.length/s.bins,out=new Float32Array(count),weights=new Float32Array(s.bins);
  for(let b=0;b<s.bins;b++){
    const low=20*(s.maxHz/20)**(b/s.bins),high=20*(s.maxHz/20)**((b+1)/s.bins);
    weights[b]=Math.max(0,Math.min(high,c.high)-Math.max(low,c.low))/(high-low);
  }
  for(let f=0;f<count;f++){
    let power=0;for(let b=0;b<s.bins;b++)power+=s.values[f*s.bins+b]*weights[b];
    out[f]=Math.min(2,Math.pow(power,0.25)*10**(c.gain/20));
  }
  return out;
}
export function detectChannels(signal:Signal,channels:Channel[]){
  const hits:DrumHit[]=[],levels=channels.map(c=>channelLevels(signal,c));
  channels.forEach((c,index)=>{
    if(!c.enabled)return;
    let baseline=0,last=-Infinity;
    levels[index].forEach((value,f)=>{
      const time=f/signal.rate,rise=value-baseline,attack=value-(levels[index][f-1]??0);
      baseline+=(value-baseline)*0.12;
      if(value<c.threshold||rise<0.1||attack<c.attack||time-last<c.gap/1000)return;
      last=time;hits.push({time,kind:c.kind,strength:Math.min(1,rise*2.5),seed:(Math.round(time*1000)*2654435761+['kick','tom','snare','hat','cymbal'].indexOf(c.kind)*1013904223)>>>0});
    });
  });
  return {hits:hits.sort((a,b)=>a.time-b.time),levels};
}
