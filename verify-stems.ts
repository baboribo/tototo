import assert from 'node:assert/strict';
import {separate} from './src/separation';
import {detectDrums,hitPosition,type DrumHit} from './src/drums';
import {planFrame,frameTime} from './src/motion';
import {type Signal,STRIDE} from './src/signal';

const input=Float32Array.from({length:22050},(_,i)=>Math.sin(i*0.063)*0.3+(i%4000<30?0.3:0));
assert.equal(frameTime(8.199999809265137),8.2,'browser seek rounding must not hold the previous frame');
assert.equal(frameTime(8.199),8.1,'real pre-boundary time stays in its own frame');
const split=separate(input);
for(let i=0;i<input.length;i++)assert.ok(Number.isFinite(split.drums[i])&&Math.abs(split.drums[i]+split.rest[i]-input[i])<1e-6);
const silentSplit=separate(new Float32Array(3000));
assert.ok(silentSplit.drums.every(v=>v===0)&&silentSplit.rest.every(v=>v===0));
const silence:Signal={values:new Float32Array(100*STRIDE),duration:2,rate:50,tempo:null};
assert.equal(detectDrums(silence).length,0);
const steady:Signal={...silence,values:Float32Array.from(silence.values,(_,i)=>i%STRIDE===0?0.8:0)};
assert.ok(detectDrums(steady).length<=1,'sustained tone must not repeatedly trigger');
const pulses:Signal={...silence,values:new Float32Array(silence.values.length)};
for(const [frame,band] of [[10,0],[25,2],[40,3]])pulses.values[frame*STRIDE+band]=0.9;
assert.deepEqual(detectDrums(pulses).map(h=>h.kind),['kick','snare','hat']);
const hits:DrumHit[]=Array.from({length:100},(_,i)=>({time:i/10,kind:'kick',strength:1,seed:((i+1)*2654435761)>>>0}));
const cells=new Set<string>();
for(const h of hits){const p=hitPosition(h);assert.ok(p.x>=130&&p.x<=175&&p.y>=90&&p.y<=135);assert.equal((p.x-130)%15,0);assert.equal((p.y-90)%15,0);assert.deepEqual(p,hitPosition(h));cells.add(`${p.x},${p.y}`);}
assert.ok(cells.size>=12,'random hits distributed throughout central grid');
const options={hits:[{...hits[0],time:0.2}],otherSignal:silence,fps:10};
const attack=planFrame(pulses,0.21,1,options);
assert.equal(attack.tiles.length,1);assert.ok(attack.trace.length>0,'drum attacks write pen ink even with silent non-drum stem');
assert.deepEqual(attack,planFrame(pulses,0.29,1,options),'10 FPS frame hold');
const moved=planFrame(pulses,0.4,1,options);
assert.equal(moved.tiles.length,1);
assert.ok(moved.tiles[0].x<attack.tiles[0].x,'drum ink must move left across frames');
assert.equal(moved.tiles[0].y,attack.tiles[0].y,'row remains fixed');
assert.equal(planFrame(pulses,2,1,options).tiles.length,0,'ink clears after exiting central square');
const rightHit=hits.find(h=>hitPosition(h).x===175)!;
const scrolling={...options,hits:[{...rightHit,time:0.2}],tempo:{bpm:120,offset:0.2,confidence:1}};
assert.equal(planFrame(pulses,0.7,1,scrolling).tiles[0].x,160,'one cell of travel per beat');
assert.equal(planFrame(pulses,2.1,1,scrolling).tiles[0].x,118,'partially visible tile survives at left clip boundary');
assert.equal(planFrame(pulses,2.2,1,scrolling).tiles.length,0,'fully clipped tile removed');
assert.deepEqual(planFrame(pulses,0.7,1,scrolling),planFrame(pulses,0.7,1,scrolling),'seek is deterministic');
// Off-grid attacks used to create overlapping, differently rounded scroll phases.
const middleHit=hits.find(h=>hitPosition(h).x===160&&hitPosition(h).y===hitPosition(rightHit).y)!;
assert.ok(middleHit);
for(const bpm of [80,127,149.75,180]) {
  const shared={...options,tempo:{bpm,offset:0,confidence:1},hits:[{...rightHit,time:0.013},{...middleHit,time:0.087}]};
  const a=planFrame(pulses,0.1,1,shared).tiles,b=planFrame(pulses,0.2,1,shared).tiles;
  assert.equal(a.length,2);assert.equal(b.length,2);
  assert.equal(a[0].x-a[1].x,15,'off-beat hits share exact grid spacing');
  assert.equal(a[0].x-b[0].x,a[1].x-b[1].x,'every tile moves the same pixels per frame');
  const repeated={...shared,hits:[{...rightHit,time:0.013},{...rightHit,time:0.087}]};
  assert.equal(planFrame(pulses,0.1,1,repeated).tiles.length,1,'same moving cell is re-struck, not layered');
}
assert.equal(planFrame(pulses,0.2,1,{hits:[],otherSignal:pulses,tempo:{bpm:150,offset:0,confidence:1}}).tiles.length,0,'metronome must not invent drum hits');
console.log(`PASS: complementary separation, silence, attacks, ${cells.size}/16 central cells, frame hold, leftward drum transport, boundary exit and stem isolation`);
