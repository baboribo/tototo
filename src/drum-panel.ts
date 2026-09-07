import {defaults,detectChannels,type Channel} from './drum-eq';
import type {Signal} from './signal';
import {recentHits,type DrumHit} from './drums';

const colors=['#cbdc8c','#e9af8e','#93cfd5','#bdabe3','#e3ce89'];
export class DrumPanel {
  private channels=defaults();
  private signal?:Signal;
  private hits:DrumHit[]=[];
  private levels:Float32Array[]=[];
  private selected=0;
  private solo=false;
  private buffer?:AudioBuffer;
  private context?:AudioContext;
  private source?:AudioBufferSourceNode;
  private filters:BiquadFilterNode[]=[];
  private previousMuted=false;
  private timer?:ReturnType<typeof setTimeout>;
  private canvas:HTMLCanvasElement;
  private controls:HTMLElement;
  private info:HTMLElement;
  private tabs:HTMLButtonElement[]=[];
  private soloButton:HTMLButtonElement;
  private lastTime=0;
  private thresholdCanvas:HTMLCanvasElement;
  private thresholdBar:HTMLDivElement;
  private thresholdArea:HTMLElement;
  constructor(private audio:HTMLAudioElement,private changed:(hits:DrumHit[])=>void){
    const host=document.createElement('section');host.className='drum-eq';host.setAttribute('aria-label','드럼 스템 EQ 반응 조절');
    host.innerHTML=`<div class="eq-heading"><div><p class="eyebrow">DRUM STEM / FREQUENCY TRIGGER</p><h2>드럼 반응 조절</h2></div><button id="eq-reset">기본값 복원</button></div>
    <p>드럼 스템의 주파수를 보며 악기별 타일·펜 반응을 조절하세요. 그래프 양쪽 선을 드래그하면 대역을 바꿀 수 있습니다.</p>
    <div class="eq-tabs" role="group" aria-label="드럼 채널"></div>
    <canvas id="drum-spectrum" width="720" height="300" aria-label="재생 시점의 드럼 주파수 스펙트럼과 선택 대역"></canvas>
    <p>대역 세기 / 반응 기준 — 가로 바를 위아래로 드래그하세요. 낮출수록 작은 소리에도 반응합니다.</p>
    <div class="eq-threshold-area"><canvas id="drum-level" width="720" height="230" aria-label="선택 대역의 최근 3초 세기와 감지 임계값"></canvas><div id="threshold-bar" role="slider" tabindex="0" aria-label="선택 드럼 감지 임계값" aria-orientation="vertical" aria-valuemin="0.02" aria-valuemax="1.5"><span></span></div></div>
    <p class="eq-note">선 이상이면 세기 조건을 충족합니다. 실제 타격은 어택 조건과 재타격 간격도 충족해야 합니다. 밝은 점은 감지된 타격입니다. 위 주파수 그래프와 달리 이 그래프는 선택 대역 전체의 분석 게인이 반영된 세기입니다.</p>
    <div class="eq-controls"></div><div class="eq-footer"><button id="eq-solo" disabled>선택 대역만 듣기</button><output id="eq-status" aria-live="polite">오디오를 먼저 불러오세요.</output></div>
    <p class="eq-note">분석 게인은 타일·펜 타격 감지에 적용됩니다. 단독 듣기는 드럼 스템에 대역 필터를 적용하며 원본·저장 파일은 바꾸지 않습니다. 주파수가 겹치는 악기는 완전히 분리되지 않습니다. 그래프는 사전 분석된 FFT를 재생 위치에 맞춰 표시합니다.</p>`;
    document.querySelector('#drum-editor-host')!.append(host);
    this.canvas=host.querySelector('canvas')!;this.controls=host.querySelector('.eq-controls')!;this.info=host.querySelector('#eq-status')!;this.soloButton=host.querySelector('#eq-solo')!;
    this.thresholdCanvas=host.querySelector('#drum-level')!;this.thresholdBar=host.querySelector('#threshold-bar')!;this.thresholdArea=host.querySelector('.eq-threshold-area')!;
    const setThreshold=(value:number)=>{
      const c=this.channels[this.selected];c.threshold=Math.round(Math.max(0.02,Math.min(1.5,value))*100)/100;
      const input=this.controls.querySelector<HTMLInputElement>(`input[aria-label="${c.kind.toUpperCase()} 감지 임계값"]`);if(input)input.value=String(c.threshold);
      this.schedule();this.draw(this.lastTime);
    };
    let dragging=false;
    const drag=(e:PointerEvent)=>{const r=this.thresholdArea.getBoundingClientRect();setThreshold((1-(e.clientY-r.top)/r.height)*1.6);};
    this.thresholdBar.onpointerdown=e=>{e.preventDefault();dragging=true;this.thresholdBar.setPointerCapture(e.pointerId);};
    this.thresholdBar.onpointermove=e=>{if(dragging)drag(e);};
    this.thresholdBar.onpointerup=()=>{dragging=false;clearTimeout(this.timer);this.recalculate();};
    this.thresholdBar.onpointercancel=()=>{dragging=false;};
    this.thresholdBar.onkeydown=e=>{
      const step=e.shiftKey?0.1:0.01,c=this.channels[this.selected];
      if(['ArrowUp','ArrowRight','ArrowDown','ArrowLeft','Home','End'].includes(e.key)){
        e.preventDefault();e.stopPropagation();setThreshold(e.key==='Home'?0.02:e.key==='End'?1.5:c.threshold+(['ArrowUp','ArrowRight'].includes(e.key)?step:-step));
      }
    };
    this.channels.forEach((c,i)=>{const button=document.createElement('button');button.textContent=c.kind.toUpperCase();button.style.setProperty('--channel',colors[i]);button.onclick=()=>{this.selected=i;this.renderControls();this.updateFilter();this.draw(this.lastTime);};host.querySelector('.eq-tabs')!.append(button);this.tabs.push(button);});
    host.querySelector('#eq-reset')!.addEventListener('click',()=>{this.channels=defaults();this.renderControls();this.recalculate();this.updateFilter();});
    this.soloButton.onclick=()=>{this.solo=!this.solo;if(this.solo)this.previousMuted=audio.muted;else audio.muted=this.previousMuted;this.soloButton.textContent=this.solo?'단독 듣기 종료':'선택 대역만 듣기';this.soloButton.setAttribute('aria-pressed',String(this.solo));this.restartSolo();};
    for(const event of ['playing','seeked','ratechange'])audio.addEventListener(event,()=>this.restartSolo());
    for(const event of ['pause','ended','emptied'])audio.addEventListener(event,()=>this.stopSource());
    let edge:'low'|'high'|undefined;
    const hz=(e:PointerEvent)=>{const r=this.canvas.getBoundingClientRect();return Math.round(20*1000**Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)));};
    this.canvas.onpointerdown=e=>{const c=this.channels[this.selected],f=hz(e);edge=Math.abs(Math.log(f/c.low))<Math.abs(Math.log(f/c.high))?'low':'high';this.canvas.setPointerCapture(e.pointerId);move(e);};
    const move=(e:PointerEvent)=>{if(!edge)return;const c=this.channels[this.selected],f=hz(e);c[edge]=edge==='low'?Math.min(f,c.high-10):Math.max(f,c.low+10);this.renderControls();this.schedule();this.updateFilter();this.draw(this.lastTime);};
    this.canvas.onpointermove=move;this.canvas.onpointerup=()=>{edge=undefined;};this.canvas.onpointercancel=()=>{edge=undefined;};
    this.renderControls();this.draw(0);
  }
  private renderControls(){
    const c=this.channels[this.selected];this.controls.replaceChildren();
    this.tabs.forEach((b,i)=>b.setAttribute('aria-pressed',String(i===this.selected)));
    const enabled=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=c.enabled;enabled.append(check,' 타일·펜 반응 켜기');check.onchange=()=>{c.enabled=check.checked;this.schedule();};this.controls.append(enabled);
    const fields:[keyof Channel,string,number,number,number][]=[['low','하한 Hz',20,19990,1],['high','상한 Hz',30,20000,1],['gain','분석 게인 dB',-18,18,0.5],['threshold','감지 임계값',0.02,1.5,0.01],['attack','어택 임계값',0.005,0.5,0.005],['gap','재타격 간격 ms',40,600,10]];
    for(const [key,name,min,max,step] of fields){
      const label=document.createElement('label'),input=document.createElement('input');label.textContent=name;input.type='number';input.min=String(min);input.max=String(max);input.step=String(step);input.value=String(c[key]);input.setAttribute('aria-label',`${c.kind.toUpperCase()} ${name}`);
      input.oninput=()=>{if(!input.value||!Number.isFinite(input.valueAsNumber))return;let v=Math.max(min,Math.min(max,input.valueAsNumber));if(key==='low')v=Math.min(v,c.high-10);if(key==='high')v=Math.max(v,c.low+10);(c as unknown as Record<string,number>)[key]=v;this.schedule();this.updateFilter();this.draw(this.lastTime);};
      input.onchange=()=>{input.value=String(c[key]);};label.append(input);this.controls.append(label);
    }
  }
  private schedule(){clearTimeout(this.timer);this.info.textContent='변경된 대역으로 타격을 계산 중…';this.timer=setTimeout(()=>this.recalculate(),150);}
  private recalculate(){
    if(!this.signal)return;
    const result=detectChannels(this.signal,this.channels);this.hits=result.hits;this.levels=result.levels;this.changed(this.hits);this.info.textContent=`적용 완료 · ${this.hits.length}개 타격 · 설정은 현재 세션에 유지됩니다`;this.draw(this.lastTime);
  }
  load(signal:Signal,samples:Float32Array,rate:number,context:AudioContext){
    this.clear();this.signal=signal;this.context=context;this.buffer=context.createBuffer(1,samples.length,rate);this.buffer.copyToChannel(new Float32Array(samples),0);this.soloButton.disabled=false;this.recalculate();
  }
  clear(){clearTimeout(this.timer);this.stopSource();if(this.solo)this.audio.muted=this.previousMuted;this.solo=false;this.buffer=undefined;this.signal=undefined;this.hits=[];this.levels=[];this.soloButton.disabled=true;this.soloButton.textContent='선택 대역만 듣기';this.soloButton.setAttribute('aria-pressed','false');this.info.textContent='오디오를 먼저 불러오세요.';this.draw(0);}
  private stopSource(){if(this.source){this.source.stop();this.source.disconnect();this.source=undefined;}this.filters.forEach(f=>f.disconnect());this.filters=[];}
  private updateFilter(){const c=this.channels[this.selected];this.filters.forEach((f,i)=>f.frequency.setTargetAtTime(Math.min((i?c.high:c.low),this.context!.sampleRate/2-1),this.context!.currentTime,0.015));}
  private restartSolo(){
    this.stopSource();if(!this.solo||!this.buffer||!this.context)return;
    this.audio.muted=true;if(this.audio.paused||this.audio.currentTime>=this.buffer.duration)return;
    const source=this.context.createBufferSource();source.buffer=this.buffer;source.playbackRate.value=this.audio.playbackRate;
    const hp=this.context.createBiquadFilter(),lp=this.context.createBiquadFilter();hp.type='highpass';lp.type='lowpass';hp.Q.value=lp.Q.value=0.707;
    this.filters=[hp,lp];this.updateFilter();source.connect(hp).connect(lp).connect(this.context.destination);source.start(0,this.audio.currentTime);this.source=source;
  }
  draw(time:number){
    this.lastTime=time;const ctx=this.canvas.getContext('2d')!,w=this.canvas.width,h=this.canvas.height,plotBottom=h-28,c=this.channels[this.selected],x=(f:number)=>Math.log(f/20)/Math.log(1000)*w;
    ctx.fillStyle='#131b19';ctx.fillRect(0,0,w,h);ctx.font='12px monospace';
    for(const f of [20,50,100,200,500,1000,2000,5000,10000,20000]){ctx.strokeStyle='#30413b';ctx.beginPath();ctx.moveTo(x(f),0);ctx.lineTo(x(f),plotBottom);ctx.stroke();ctx.fillStyle='#9aaea5';ctx.fillText(f>=1000?`${f/1000}k`:String(f),Math.min(w-40,x(f)+4),h-7);}
    ctx.fillStyle=colors[this.selected]+'22';ctx.fillRect(x(c.low),0,x(c.high)-x(c.low),plotBottom);
    const s=this.signal?.spectrum,frame=Math.floor(time*(this.signal?.rate??50));
    if(s&&time>=0&&time<this.signal!.duration){ctx.strokeStyle='#d7e7d1';ctx.beginPath();for(let b=0;b<s.bins;b++){
      const power=s.values[frame*s.bins+b]??0,db=10*Math.log10(Math.max(1e-8,power));const px=x(20*(s.maxHz/20)**((b+0.5)/s.bins)),y=plotBottom-Math.max(0,Math.min(1,(db+70)/70))*(plotBottom-24);b?ctx.lineTo(px,y):ctx.moveTo(px,y);
    }ctx.stroke();}
    ctx.strokeStyle=colors[this.selected];ctx.lineWidth=2;for(const f of [c.low,c.high]){ctx.beginPath();ctx.moveTo(x(f),0);ctx.lineTo(x(f),plotBottom);ctx.stroke();}ctx.lineWidth=1;
    ctx.fillStyle=colors[this.selected];ctx.fillText(`${c.kind.toUpperCase()}  ${c.low}–${c.high} Hz  /  ${c.gain>0?'+':''}${c.gain} dB detection`,16,20);
    const recent=recentHits(this.hits,time,0.12);this.tabs.forEach((b,i)=>{b.dataset.hit=String(recent.some(h=>h.kind===this.channels[i].kind));b.title=`대역 세기 ${(this.levels[i]?.[frame]??0).toFixed(2)} / ${this.channels[i].enabled?'반응 켜짐':'반응 꺼짐'}`;});
    const lc=this.thresholdCanvas.getContext('2d')!,lw=this.thresholdCanvas.width,lh=this.thresholdCanvas.height,level=this.levels[this.selected],rate=this.signal?.rate??50;
    const y=(v:number)=>lh*(1-Math.max(0,Math.min(1.6,v))/1.6);
    lc.fillStyle='#111a17';lc.fillRect(0,0,lw,lh);lc.font='12px monospace';
    for(const v of [0.4,0.8,1.2,1.6]){lc.strokeStyle='#2d4137';lc.beginPath();lc.moveTo(0,y(v));lc.lineTo(lw,y(v));lc.stroke();lc.fillStyle='#8ca294';lc.fillText(v.toFixed(1),4,Math.max(12,y(v)-3));}
    lc.strokeStyle=colors[this.selected];lc.beginPath();
    for(let px=0;px<lw;px++){const t=time-3+px/(lw-1)*3,v=t>=0?(level?.[Math.floor(t*rate)]??0):0;px?lc.lineTo(px,y(v)):lc.moveTo(px,y(v));}lc.stroke();
    for(const hit of recentHits(this.hits,time,3,Infinity)){if(hit.kind!==c.kind)continue;lc.fillStyle='#f2f6cf';lc.beginPath();lc.arc((hit.time-time+3)/3*lw,y(level?.[Math.floor(hit.time*rate)]??0),3,0,Math.PI*2);lc.fill();}
    const current=time>=0&&time<(this.signal?.duration??0)?(level?.[frame]??0):0;
    lc.fillStyle=current>=c.threshold?'#e7eeb5':'#9eb5a8';lc.fillText(`현재 ${current.toFixed(2)} / ${current>=c.threshold?'세기 조건 충족':'기준 미만'}${c.enabled?'':' / 채널 꺼짐'}`,Math.max(120,lw-300),16);
    this.thresholdBar.style.top=`${(1-c.threshold/1.6)*100}%`;
    this.thresholdBar.style.setProperty('--channel',colors[this.selected]);
    this.thresholdBar.setAttribute('aria-valuenow',String(c.threshold));this.thresholdBar.setAttribute('aria-valuetext',`${c.kind.toUpperCase()} ${c.threshold.toFixed(2)} 이상`);
    this.thresholdBar.querySelector('span')!.textContent=`↕ ${c.kind.toUpperCase()} 기준 ${c.threshold.toFixed(2)}`;
  }
}
