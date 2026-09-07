// verify-drum-eq.ts
import assert from "node:assert/strict";

// src/tempo.ts
function detectTempo(values, rate2, stride) {
  const count = values.length / stride;
  if (count < rate2 * 4) return null;
  const novelty = new Float32Array(count);
  let power = 0, peaks = 0;
  for (let i = 1; i < count; i++) {
    const v = Math.max(0, values[i * stride + 6] - values[(i - 1) * stride + 6] * 0.8) + Math.max(0, values[i * stride] - values[(i - 1) * stride]) * 0.5;
    novelty[i] = v;
    power += v * v;
    if (v > 0.1 && novelty[i - 1] < v) peaks++;
  }
  if (power < 0.03 || peaks < 5) return null;
  const correlation = (lag) => {
    let sum = 0, aPower = 0, bPower = 0;
    for (let i = Math.ceil(lag); i < count; i++) {
      const p = i - lag, j = Math.floor(p), f = p - j;
      const a = novelty[i], b = novelty[j] * (1 - f) + novelty[j + 1] * f;
      sum += a * b;
      aPower += a * a;
      bPower += b * b;
    }
    return sum / Math.max(1e-9, Math.sqrt(aPower * bPower));
  };
  let bestBpm = 0, bestScore = 0, bestCorrelation = 0;
  for (let bpm = 65; bpm <= 190; bpm += 0.25) {
    const lag = 60 * rate2 / bpm, c = correlation(lag);
    const score = c * 0.65 + correlation(lag * 2) * 0.35;
    if (score > bestScore) {
      bestScore = score;
      bestBpm = bpm;
      bestCorrelation = c;
    }
  }
  if (bestCorrelation < 0.24) return null;
  const period = 60 / bestBpm;
  let offset = 0, phaseScore = -1;
  for (let phase = 0; phase < period; phase += 1 / (rate2 * 2)) {
    let score = 0, beats = 0;
    for (let time = phase; time < count / rate2; time += period) {
      const index = Math.round(time * rate2);
      score += (novelty[index] ?? 0) + ((novelty[index - 1] ?? 0) + (novelty[index + 1] ?? 0)) * 0.35;
      beats++;
    }
    score /= Math.max(1, beats);
    if (score > phaseScore) {
      phaseScore = score;
      offset = phase;
    }
  }
  return { bpm: bestBpm, offset, confidence: Math.min(1, bestCorrelation) };
}

// src/signal.ts
var RATE = 50;
var STRIDE = 7;
function analyse(samples2, sampleRate, spectral = false) {
  const n = 2048, count = Math.ceil(samples2.length / sampleRate * RATE);
  const values = new Float32Array(count * STRIDE);
  const bins = 128, maxHz = Math.min(2e4, sampleRate / 2);
  const spectrum = spectral ? { values: new Float32Array(count * bins), bins, maxHz } : void 0;
  const real = new Float64Array(n), imaginary = new Float64Array(n);
  const window = Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)));
  const edges = [40, 180, 500, 2e3, 8e3, Math.min(16e3, sampleRate / 2)];
  for (let frame = 0; frame < count; frame++) {
    const start = Math.round(frame / RATE * sampleRate) - n / 2;
    let energy = 0;
    for (let i = 0; i < n; i++) {
      const sample = samples2[start + i] ?? 0;
      real[i] = sample * window[i];
      imaginary[i] = 0;
      energy += sample * sample;
    }
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) [real[i], real[j]] = [real[j], real[i]];
    }
    for (let length = 2; length <= n; length <<= 1) {
      const angle = -2 * Math.PI / length, wr = Math.cos(angle), wi = Math.sin(angle);
      for (let start2 = 0; start2 < n; start2 += length) {
        let ur = 1, ui = 0;
        for (let j = 0; j < length / 2; j++) {
          const a = start2 + j, b = a + length / 2;
          const tr = real[b] * ur - imaginary[b] * ui, ti = real[b] * ui + imaginary[b] * ur;
          real[b] = real[a] - tr;
          imaginary[b] = imaginary[a] - ti;
          real[a] += tr;
          imaginary[a] += ti;
          const next = ur * wr - ui * wi;
          ui = ur * wi + ui * wr;
          ur = next;
        }
      }
    }
    if (spectrum) for (let i = 1; i < n / 2; i++) {
      const hz = i * sampleRate / n;
      if (hz < 20 || hz >= maxHz) continue;
      const bin = Math.min(bins - 1, Math.floor(Math.log(hz / 20) / Math.log(maxHz / 20) * bins));
      spectrum.values[frame * bins + bin] += (real[i] ** 2 + imaginary[i] ** 2) / (n * n);
    }
    for (let band = 0; band < 5; band++) {
      let power = 0;
      for (let i = Math.max(1, Math.ceil(edges[band] * n / sampleRate)); i < Math.min(n / 2, Math.ceil(edges[band + 1] * n / sampleRate)); i++) power += real[i] ** 2 + imaginary[i] ** 2;
      values[frame * STRIDE + band] = Math.sqrt(power) / n;
    }
    values[frame * STRIDE + 5] = Math.sqrt(energy / n);
  }
  const levels = Array.from({ length: count }, (_, i) => values[i * STRIDE + 5]).sort((a, b) => a - b);
  const reference = Math.max(0.015, levels[Math.floor(count * 0.95)] ?? 0);
  if (spectrum) for (let i = 0; i < spectrum.values.length; i++) spectrum.values[i] /= (reference * 0.58) ** 2;
  let baseline = 0, envelope = 0;
  for (let frame = 0; frame < count; frame++) {
    const offset = frame * STRIDE;
    const level = Math.min(1, values[offset + 5] / reference);
    let flux = 0;
    for (let band = 0; band < 5; band++) {
      const value = Math.min(1, Math.sqrt(values[offset + band] / (reference * 0.58)));
      const previous = frame ? values[offset - STRIDE + band] : 0;
      values[offset + band] = value;
      flux += Math.max(0, value - previous - 0.015) / 5;
    }
    envelope = Math.max(flux * 4, Math.max(0, level - baseline - 0.08), envelope * 0.76);
    baseline += (level - baseline) * 0.14;
    values[offset + 5] = level;
    values[offset + 6] = Math.min(1, envelope);
  }
  return { values, duration: samples2.length / sampleRate, rate: RATE, tempo: detectTempo(values, RATE, STRIDE), spectrum };
}

// src/drum-eq.ts
var defaults = () => [
  ["kick", 40, 180],
  ["snare", 500, 2500],
  ["hat", 4e3, 1e4],
  ["tom", 180, 500],
  ["cymbal", 9e3, 18e3]
].map(([kind, low, high2]) => ({ kind, low: Number(low), high: Number(high2), gain: 0, threshold: 0.16, attack: 0.035, gap: kind === "hat" ? 70 : 110, enabled: true }));
function channelLevels(signal2, c) {
  const s = signal2.spectrum;
  if (!s) return new Float32Array();
  const count = s.values.length / s.bins, out = new Float32Array(count), weights = new Float32Array(s.bins);
  for (let b = 0; b < s.bins; b++) {
    const low = 20 * (s.maxHz / 20) ** (b / s.bins), high2 = 20 * (s.maxHz / 20) ** ((b + 1) / s.bins);
    weights[b] = Math.max(0, Math.min(high2, c.high) - Math.max(low, c.low)) / (high2 - low);
  }
  for (let f = 0; f < count; f++) {
    let power = 0;
    for (let b = 0; b < s.bins; b++) power += s.values[f * s.bins + b] * weights[b];
    out[f] = Math.min(2, Math.pow(power, 0.25) * 10 ** (c.gain / 20));
  }
  return out;
}
function detectChannels(signal2, channels2) {
  const hits = [], levels = channels2.map((c) => channelLevels(signal2, c));
  channels2.forEach((c, index) => {
    if (!c.enabled) return;
    let baseline = 0, last = -Infinity;
    levels[index].forEach((value, f) => {
      const time = f / signal2.rate, rise = value - baseline, attack = value - (levels[index][f - 1] ?? 0);
      baseline += (value - baseline) * 0.12;
      if (value < c.threshold || rise < 0.1 || attack < c.attack || time - last < c.gap / 1e3) return;
      last = time;
      hits.push({ time, kind: c.kind, strength: Math.min(1, rise * 2.5), seed: Math.round(time * 1e3) * 2654435761 + ["kick", "tom", "snare", "hat", "cymbal"].indexOf(c.kind) * 1013904223 >>> 0 });
    });
  });
  return { hits: hits.sort((a, b) => a.time - b.time), levels };
}

// verify-drum-eq.ts
var rate = 22050;
var samples = Float32Array.from({ length: rate * 3 }, (_, i) => {
  const t = i / rate, age = t % 0.5;
  return age < 0.12 ? Math.sin(2 * Math.PI * 90 * t) * Math.exp(-age * 35) * 0.65 : 0;
});
var signal = analyse(samples, rate, true);
var channels = defaults();
assert.ok(signal.spectrum && signal.spectrum.values.every(Number.isFinite));
var base = detectChannels(signal, channels);
assert.ok(base.hits.filter((h) => h.kind === "kick").length >= 5, "kick pulses detected");
channels[0].enabled = false;
assert.equal(detectChannels(signal, channels).hits.filter((h) => h.kind === "kick").length, 0, "disable removes actual tile triggers");
channels[0].enabled = true;
channels[0].low = 6e3;
channels[0].high = 9e3;
assert.equal(detectChannels(signal, channels).hits.filter((h) => h.kind === "kick").length, 0, "frequency controls change analysis");
var high = defaults();
high[0].threshold = 1.5;
assert.ok(detectChannels(signal, high).hits.filter((h) => h.kind === "kick").length < base.hits.filter((h) => h.kind === "kick").length, "threshold controls detection");
var slow = defaults();
slow[0].gap = 600;
assert.ok(detectChannels(signal, slow).hits.filter((h) => h.kind === "kick").length < base.hits.filter((h) => h.kind === "kick").length, "retrigger interval enforced");
assert.equal(detectChannels(analyse(new Float32Array(rate), rate, true), defaults()).hits.length, 0, "silence stays silent");
assert.deepEqual(detectChannels(signal, defaults()).hits, base.hits, "settings restore deterministically");
console.log("PASS: spectrum, adjustable frequency/threshold/retrigger, channel enable, silence, deterministic restore");
