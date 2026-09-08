import assert from 'node:assert/strict';
import {separate} from './src/separation';
import {detectDrums,type DrumHit} from './src/drums';
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
const other:Signal={...silence,values:new Float32Array(silence.values.length)};
for(let frame=0;frame<other.values.length/STRIDE;frame++){
  for(let band=0;band<5;band++)other.values[frame*STRIDE+band]=0.9;
  other.values[frame*STRIDE+5]=0.8;
}
const baseOptions={hits:[] as DrumHit[],otherSignal:other,fps:10,tileFade:0.3};
const base=planFrame(pulses,0.9,1,baseOptions);
assert.ok(base.tiles.length>=6,'the non-drum stem holds its assigned tiles');
assert.ok(base.tiles.every(tile=>tile.source==='other'),'an empty hit list cannot invent drum tiles');
assert.ok(base.tiles.every(tile=>tile.x>=130&&tile.x<=175&&tile.y>=90&&tile.y<=135),'assigned tiles remain in the fixed 4x4 grid');

const kick:DrumHit={time:1,kind:'kick',strength:1,seed:1};
const options={...baseOptions,hits:[kick]};
const attack=planFrame(pulses,1.01,1,options);
assert.ok(attack.tiles.some(tile=>tile.source==='drums'),'a kick lights its assigned pads');
assert.equal(attack.tiles.filter(tile=>tile.source==='other').length,0,'a strong kick switches the held non-drum pads off');
assert.deepEqual(attack.tiles.filter(tile=>tile.source==='drums').map(tile=>[tile.x,tile.y]),[[130,105],[145,120]],'kick reuses fixed assigned pads');
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
console.log('PASS: complementary separation, silence, attacks, fixed stem-assigned tiles, kick ducking, fade recovery, frame hold and deterministic seeking');
