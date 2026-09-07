import assert from 'node:assert/strict';
import { analyse, STRIDE, type Signal } from './src/signal';
import { planFrame } from './src/motion';
import { drumInk, perimeter, TRACE_START, TRACE_END, TRACE_SPEED, PERIMETER_SPEED } from './src/reactive-ink';
import type { DrumHit } from './src/drums';

const silence: Signal = { values: new Float32Array(4 * 50 * STRIDE), duration: 4, rate: 50, tempo: { bpm: 120, offset: 0, confidence: 1 } };
const impulse: Signal = { ...silence, values: new Float32Array(silence.values.length) };
impulse.values.set([0.9, 0, 0, 0, 0, 0.9, 0.9], 54 * STRIDE); // 1.08s, between display frames
const hit: DrumHit = { time: 1.08, kind: 'kick', strength: 1, seed: 1 };
const options = { hits: [hit], otherSignal: silence };
assert.equal(planFrame(silence, 1, 1, options).trace.length, 0, 'no mark before actual attack');
const attack = planFrame(impulse, 1.1, 1, options);
assert(attack.trace.length > 0 && attack.pen > 0, 'drum attack writes even when other stem is silent');
assert(attack.bars.length > 0, 'subframe drum transient survives in the perimeter');
assert.deepEqual(attack, planFrame(impulse, 1.199, 1, options), 'whole artwork holds at 10 FPS');
assert.equal(planFrame(impulse, 1.1, 1, { hits: [], otherSignal: impulse }).trace.length, 0, 'other stem and BPM cannot invent pen hits');
assert.equal(planFrame(impulse, 1.1, 1, { ...options, perimeterSource: 'other' }).bars.length, 0, 'perimeter source routing is isolated');
const a = drumInk([hit], 1.2, 1, 0.1), b = drumInk([hit], 1.3, 1, 0.1);
assert.deepEqual(a.trace.map(m => [m.height, m.tone, m.phase]), b.trace.map(m => [m.height, m.tone, m.phase]), 'printed texture and shape travel intact');
assert(a.trace.every((m, i) => m.x - b.trace[i].x === 16), 'ink travels left at a shared 160 px/s');
const arrival = hit.time + (TRACE_START - TRACE_END) / TRACE_SPEED;
assert.equal(drumInk([hit], arrival - 0.02, 1, 0.1).eraser, 0, 'eraser does not react before arrival');
assert(drumInk([hit], arrival + 0.02, 1, 0.1).eraser > 0, 'eraser reacts to the same mark arriving');
assert.equal(drumInk([hit], arrival + 0.2, 1, 0.1).trace.length, 0, 'finite ink history clears');
for (const fps of [10, 12, 24, 60]) {
  const post = Math.ceil(hit.time * fps) / fps;
  const frame = planFrame(impulse, post, 1, { ...options, fps });
  assert(frame.pen > 0 && frame.bars.length > 0, `${fps} FPS retains attack`);
  planFrame(impulse, 3.8, 1, { ...options, fps });
  assert.deepEqual(frame, planFrame(impulse, post, 1, { ...options, fps }), 'seek order cannot change ink');
}
assert.deepEqual(perimeter(silence, silence, 1, 1, 0.1), { bars: [], rings: 0 }, 'silence stays empty despite tempo');
const steady = { ...silence, values: Float32Array.from(silence.values, (_, i) => i % STRIDE < 6 ? 0.95 : 0) };
const border = perimeter(steady, steady, 1, 1, 0.1);
assert(border.bars.length > 0 && border.bars.length < 344, 'loud broadband audio still has real gaps');
assert(border.bars.every(b => b.x >= 117 && b.x + b.width <= 203 && b.y >= 77 && b.y + b.height <= 163), 'fixed contour bounds');
assert(border.bars.every(b => Math.max(b.width, b.height) === 3), 'fixed stroke thickness');
const later = perimeter(steady, steady, 1.5, 1, 0.1);
assert.notDeepEqual(border.bars, later.bars, 'the outer fragments must move, not only flash in fixed slots');
assert.deepEqual(border.bars.map(b => [b.tone, b.phase]), later.bars.map(b => [b.tone, b.phase]), 'printed texture travels with each fragment');
// Use strips away from corner overlaps to check the signed transport exactly.
const distance = (b: typeof border.bars[number]) => b.height === 3 ? (b.y === 77 ? b.x - 117 : 172 + 202 - b.x) : (b.x === 200 ? 86 + b.y - 77 : 258 + 162 - b.y);
assert(border.bars.every((b, i) => (distance(b) - distance(later.bars[i]) + 344) % 344 === PERIMETER_SPEED / 2), 'all fragments travel 16 pixels along the fixed square in half a second');
for (let t = 0; t < 12; t += 0.1) {
  const frame = perimeter(steady, steady, t, 1, 0.1);
  assert(frame.bars.every(b => b.x >= 117 && b.x + b.width <= 203 && b.y >= 77 && b.y + b.height <= 163), 'corner wrapping stays on the square');
}
const rate = 22050;
const low = analyse(Float32Array.from({length: rate * 2}, (_, i) => 0.2 * Math.sin(i / rate * Math.PI * 180)), rate);
const high = analyse(Float32Array.from({length: rate * 2}, (_, i) => 0.2 * Math.sin(i / rate * Math.PI * 10000)), rate);
assert.notDeepEqual(perimeter(low, undefined, 1, 1, 0.1, 'drums').bars, perimeter(high, undefined, 1, 1, 0.1, 'drums').bars, 'different audio bands excite different fragments');
console.log('PASS: segmented audio perimeter, transient hold, stem routing, drum-only pen, immutable marks, delayed eraser, silence and deterministic seeking');
