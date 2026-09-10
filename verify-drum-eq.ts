import assert from 'node:assert/strict';
import { analyse } from './src/signal';
import { defaults, detectChannels } from './src/drum-eq';
const rate = 22050;
const samples = Float32Array.from({ length: rate * 3 }, (_, i) => {
  const t = i / rate,
    age = t % 0.5;
  return age < 0.12 ? Math.sin(2 * Math.PI * 90 * t) * Math.exp(-age * 35) * 0.65 : 0;
});
const signal = analyse(samples, rate, true),
  channels = defaults();
assert.ok(signal.spectrum && signal.spectrum.values.every(Number.isFinite));
const base = detectChannels(signal, channels);
assert.ok(base.hits.filter((h) => h.kind === 'kick').length >= 5, 'kick pulses detected');
channels[0].enabled = false;
assert.equal(
  detectChannels(signal, channels).hits.filter((h) => h.kind === 'kick').length,
  0,
  'disable removes actual tile triggers',
);
channels[0].enabled = true;
channels[0].low = 6000;
channels[0].high = 9000;
assert.equal(
  detectChannels(signal, channels).hits.filter((h) => h.kind === 'kick').length,
  0,
  'frequency controls change analysis',
);
const high = defaults();
high[0].threshold = 1.5;
assert.ok(
  detectChannels(signal, high).hits.filter((h) => h.kind === 'kick').length <
    base.hits.filter((h) => h.kind === 'kick').length,
  'threshold controls detection',
);
const slow = defaults();
slow[0].gap = 600;
assert.ok(
  detectChannels(signal, slow).hits.filter((h) => h.kind === 'kick').length <
    base.hits.filter((h) => h.kind === 'kick').length,
  'retrigger interval enforced',
);
assert.equal(
  detectChannels(analyse(new Float32Array(rate), rate, true), defaults()).hits.length,
  0,
  'silence stays silent',
);
assert.deepEqual(
  detectChannels(signal, defaults()).hits,
  base.hits,
  'settings restore deterministically',
);
console.log(
  'PASS: spectrum, adjustable frequency/threshold/retrigger, channel enable, silence, deterministic restore',
);
