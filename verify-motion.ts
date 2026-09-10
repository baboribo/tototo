import assert from 'node:assert/strict';
import { analyse, at, STRIDE } from './src/signal';
import { planFrame, frameTime } from './src/motion';
import { detectTempo, beatPulse } from './src/tempo';

const rate = 22050;
const tone = (hz: number, duration = 2) =>
  Float32Array.from(
    { length: rate * duration },
    (_, i) => 0.18 * Math.sin((i / rate) * Math.PI * 2 * hz),
  );
for (const [hz, expected] of [
  [90, 0],
  [300, 1],
  [900, 2],
  [5000, 3],
  [9500, 4],
]) {
  const signal = analyse(tone(hz), rate),
    feature = at(signal, 1);
  assert(feature.bands[expected] > 0.7, `${hz} Hz must activate its band`);
  assert(
    feature.bands.filter((_, i) => i !== expected).every((v) => v < 0.08),
    `${hz} Hz must not activate unrelated bands`,
  );
  assert(Array.from(signal.values).every((v) => Number.isFinite(v) && v >= 0 && v <= 1));
}
const silent = analyse(new Float32Array(rate * 2), rate);
assert(
  silent.values.every((v) => v === 0),
  'silence must remain zero',
);
assert.equal(planFrame(silent, 1).active, false);
assert.equal(planFrame(silent, 1).trace.length, 0);

const source = new Float32Array(rate * 4);
source.set(tone(900, 1));
const signal = analyse(source, rate);
const baseline = planFrame(signal, 0.9);
for (let t = 0; t < 4; t += 1 / 144) planFrame(signal, t);
assert.deepEqual(planFrame(signal, 0.9), baseline, 'history/refresh-rate independent seeking');
assert.deepEqual(planFrame(signal, 0.9), planFrame(signal, 0.9), 'pause must freeze');
assert.deepEqual(
  planFrame(signal, 0.901),
  planFrame(signal, 0.999),
  '10 FPS holds one complete frame for 100 ms',
);
const a = planFrame(signal, 0.6, 1, { impact: 0 }).tiles,
  b = planFrame(signal, 0.7, 1, { impact: 0 }).tiles;
assert(a.length > 0 && a.length === b.length);
assert(
  b.every((tile, i) => tile.x < a[i].x && tile.y === a[i].y && tile.tone === a[i].tone),
  'printed cells retain their shape while travelling left',
);
assert(planFrame(signal, 1.1).trace.length > 0, 'ink outlives present signal');
assert.equal(planFrame(signal, 3).trace.length, 0, 'finite history clears in silence');
assert.equal(planFrame(signal, 3).active, false);
assert.equal(signal.values.length % STRIDE, 0);
assert.deepEqual(at(signal, -1).bands, [0, 0, 0, 0, 0]);
console.log(
  'PASS: 5 spectral bands, silence, finite values, deterministic seek/pause, leftward cell transport, ink tail and clear.',
);

// Known tempo fixtures exercise fractional lags and phase, independently of DSP.
for (const expected of [80, 100, 120, 127, 150, 180]) {
  const values = new Float32Array(50 * 24 * STRIDE),
    period = 60 / expected,
    offset = 0.23;
  for (let t = offset; t < 24; t += period) {
    const i = Math.round(t * 50);
    for (let j = 0; j < 4; j++)
      if ((i + j) * STRIDE + 6 < values.length) {
        values[(i + j) * STRIDE + 6] = Math.exp(-j);
        values[(i + j) * STRIDE] = Math.exp(-j);
        values[(i + j) * STRIDE + 5] = Math.exp(-j);
      }
  }
  const tempo = detectTempo(values, 50, STRIDE);
  console.log('tempo fixture', expected, tempo);
  assert(tempo && Math.abs(tempo.bpm - expected) < 1.1, `${expected} BPM recovery`);
  const phaseError = Math.abs(((tempo.offset - offset + period * 1.5) % period) - period / 2);
  assert(phaseError < 0.055, 'beat phase within analysis hop aperture');
}
assert.equal(detectTempo(new Float32Array(50 * 10 * STRIDE), 50, STRIDE), null);
const fake = {
  values: new Float32Array(50 * 4 * STRIDE),
  duration: 4,
  rate: 50,
  tempo: { bpm: 120, offset: 0.23, confidence: 1 },
};
for (let i = 0; i < 200; i++) {
  fake.values[i * STRIDE] = 0.8;
  fake.values[i * STRIDE + 2] = 0.65;
  fake.values[i * STRIDE + 5] = 0.8;
}
const flash = planFrame(fake, 1.3, 1, { impact: 1 }),
  off = planFrame(fake, 1.3, 1, { impact: 0 });
assert.notDeepEqual(
  flash.tiles,
  off.tiles,
  'beat changes ink tones even for already present tiles',
);
assert.deepEqual(
  flash.tiles.map((t) => [t.x, t.y]),
  off.tiles.map((t) => [t.x, t.y]),
  'beat does not scale or move tiles',
);
assert.equal(beatPulse(fake.tempo, 1.3).pulse, 1);
assert.equal(beatPulse(fake.tempo, 1.5).pulse, 0);
assert.equal(frameTime(1.299), 1.2);
assert.deepEqual(planFrame(fake, 1.301), planFrame(fake, 1.399));
console.log(
  'PASS: automatic BPM/phase, no tempo in silence, 10 FPS hold, beat-synchronous ink flash with unchanged geometry.',
);
