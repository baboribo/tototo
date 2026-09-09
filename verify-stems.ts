import assert from 'node:assert/strict';
import {separate} from './src/separation';
import {detectDrums,type DrumHit} from './src/drums';
import {planFrame,frameTime,preloadTiles} from './src/motion';
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
const other:Signal={...silence,values:new Float32Array(silence.values.length)};
for(let frame=0;frame<other.values.length/STRIDE;frame++){
  for(let band=0;band<5;band++)other.values[frame*STRIDE+band]=0.9;
  other.values[frame*STRIDE+5]=0.8;
}
const baseOptions={hits:[] as DrumHit[],otherSignal:other,fps:10,tileFade:0.3};
const base=planFrame(pulses,0.9,1,baseOptions);
assert.ok(base.tiles.length>=6,'the non-drum stem holds its assigned tiles');
assert.ok(base.tiles.every(tile=>tile.source==='other'),'an empty hit list cannot invent drum tiles');
assert.ok(base.tiles.every(tile=>tile.x>115&&tile.x<190&&tile.y>=90&&tile.y<=135),'moving tiles intersect the fixed crop, including partial edge cells');

const kick:DrumHit={time:1,kind:'kick',strength:1,seed:1};
const options={...baseOptions,hits:[kick],tempo:{bpm:120,offset:0,confidence:1}};
const attack=planFrame(pulses,1.01,1,options);
assert.ok(attack.tiles.some(tile=>tile.source==='drums'),'a kick lights its assigned pads');
assert.equal(attack.tiles.filter(tile=>tile.source==='other').length,0,'a strong kick switches the held non-drum pads off');
assert.equal(attack.tiles.filter(tile=>tile.source==='drums').length,1,'one detected hit prints one moving cell');
assert.ok(attack.trace.length>0,'drum attacks still write pen ink');
assert.deepEqual(attack,planFrame(pulses,1.099,1,options),'10 FPS frame hold');

const recovering=planFrame(pulses,1.2,1,options).tiles.filter(tile=>tile.source==='other');
assert.ok(recovering.length>0&&recovering.every(tile=>(tile.opacity??1)<1),'held pads fade back after the kick blackout');
const fast=planFrame(pulses,1.3,1,{...options,tileFade:0.1}).tiles.filter(tile=>tile.source==='other').reduce((sum,tile)=>sum+(tile.opacity??1),0);
const slow=planFrame(pulses,1.3,1,{...options,tileFade:0.6}).tiles.filter(tile=>tile.source==='other').reduce((sum,tile)=>sum+(tile.opacity??1),0);
assert.ok(fast>slow,'tile fade duration controls recovery speed');
assert.deepEqual(planFrame(pulses,1.2,1,options),planFrame(pulses,1.2,1,options),'seek is deterministic');

const metronome=planFrame(pulses,0.9,1,{hits:[],otherSignal:other,tempo:{bpm:150,offset:0,confidence:1}});
assert.ok(metronome.tiles.length>0&&metronome.tiles.every(tile=>tile.source==='other'),'tempo can time motion but cannot invent drum pads');
console.log('PASS: complementary separation, silence, attacks, stem history, kick ducking, fade recovery and frame hold');

for (const bpm of [80, 127, 149.75, 180]) {
  const scrolling = {...baseOptions, tempo:{bpm,offset:0,confidence:1}};
  const a = planFrame(pulses,0.6,1,scrolling).tiles;
  const b = planFrame(pulses,0.7,1,scrolling).tiles;
  const step = Math.round(0.7*bpm/4)-Math.round(0.6*bpm/4);
  assert.ok(step>0);
  let compared = 0;
  for (const tile of a) {
    const next = b.find(next=>next.cell===tile.cell);
    if (!next) continue;
    compared++;
    assert.equal(next.x,tile.x-step,'surviving cells all move by the same BPM-driven pixel step');
    assert.equal(next.y,tile.y);
    assert.equal(next.tone,tile.tone,'printed texture remains attached to its history cell');
  }
  assert.ok(compared>0,'test compares actual surviving tiles');
  assert.equal(new Set(b.map(tile=>tile.cell)).size,b.length,'no wrapped copies or overlapping cell identities');
  planFrame(pulses,1.8,1,scrolling);
  assert.deepEqual(planFrame(pulses,0.6,1,scrolling).tiles,a,'scroll position is independent of seek history');
}
const long:Signal={...other,duration:8,values:new Float32Array(8*50*STRIDE)};
long.values.set(other.values);
const historyOptions={...baseOptions,otherSignal:long,tempo:{bpm:120,offset:0,confidence:1}};
const before=planFrame(silence,1.5,1,historyOptions).tiles;
const after=planFrame(silence,3.5,1,historyOptions).tiles;
assert.ok(before.length>0);
assert.ok(after.every(tile=>!before.some(old=>old.cell===tile.cell)),'a full crop traversal never recycles departed cells');
assert.equal(planFrame(silence,5,1,historyOptions).tiles.length,0,'silence leaves empty new columns after finite history exits');
const changed:Signal={...long,values:long.values.slice()};
for(let f=100;f<200;f++) {changed.values[f*STRIDE+3]=1;changed.values[f*STRIDE+5]=1;}
assert.notDeepEqual(planFrame(silence,3.5,1,{...historyOptions,otherSignal:changed}).tiles,after,'new audio changes incoming tile content');
assert.deepEqual(planFrame(silence,1.5,1,{...historyOptions,otherSignal:changed}).tiles,before,'future audio cannot rewrite past tiles');
assert.equal(planFrame(silence,4,1,{...options,otherSignal:silence}).tiles.length,0,'a past drum hit cannot reappear on the right');
console.log('PASS: non-wrapping history, changing audio content, shared transport, fractional BPM, finite lifetime and deterministic seek');
for(const fps of [10,24]) {
  const sustained={...long,values:Float32Array.from(long.values,(_,i)=>other.values[i%other.values.length])};
  const config={...options,fps,otherSignal:sustained,hits:[kick,{...kick,time:6,seed:12345}]};
  const track=preloadTiles(pulses,1,config);
  assert.equal(track.frames.length,Math.ceil(8*fps)+1,'preload covers the entire song');
  assert.ok(track.tileCount>0);
  const original=JSON.stringify(track);
  const atTime=(time:number)=>planFrame(pulses,time,1,{...config,preloadedTiles:track});
  const struck=atTime(1),recovered=atTime(1.3),quiet=atTime(1.6);
  assert.equal(struck.tiles.length,track.strip.length,'all strip tiles have reaction state, not only visible tiles');
  const futureDrum=struck.tiles.find(tile=>tile.source==='drums'&&tile.x>=190&&(tile.opacity??0)>0);
  assert.ok(futureDrum,'a future offscreen drum tile reacts to the current kick before reaching the crop');
  assert.equal(quiet.tiles.find(tile=>tile.cell===futureDrum.cell)?.opacity,0,'offscreen drum tile also releases while still hidden');
  const hiddenOther=recovered.tiles.find(tile=>tile.source==='other'&&tile.x>=190&&(tile.opacity??0)>0);
  assert.ok(hiddenOther,'offscreen rest tiles recover from kick ducking on the shared clock');
  assert.equal(struck.tiles.find(tile=>tile.cell===hiddenOther.cell)?.opacity,0,'kick ducks the offscreen rest tile');
  assert.deepEqual(atTime(1),struck,'full-strip reactions are deterministic after seeking');
  assert.equal(JSON.stringify(track),original,'playback does not mutate preloaded world positions');
}
console.log('PASS: full-strip preload, offscreen/future tile reactions, kick/recovery, 10/24 FPS and immutable strip playback');
