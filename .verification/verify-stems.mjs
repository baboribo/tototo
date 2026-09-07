// verify-stems.ts
import assert from "node:assert/strict";

// src/separation.ts
function fft(real, imag, inverse = false) {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }
  for (let length = 2; length <= n; length <<= 1) {
    const a = (inverse ? 2 : -2) * Math.PI / length, wr = Math.cos(a), wi = Math.sin(a);
    for (let start = 0; start < n; start += length) {
      let ur = 1, ui = 0;
      for (let j = 0; j < length / 2; j++) {
        const x = start + j, y = x + length / 2, tr = real[y] * ur - imag[y] * ui, ti = real[y] * ui + imag[y] * ur;
        real[y] = real[x] - tr;
        imag[y] = imag[x] - ti;
        real[x] += tr;
        imag[x] += ti;
        const next = ur * wr - ui * wi;
        ui = ur * wi + ui * wr;
        ur = next;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) {
    real[i] /= n;
    imag[i] /= n;
  }
}
function separate(samples) {
  const n = 1024, hop = 256, bins = n / 2 + 1, frames = Math.ceil(samples.length / hop) + 1;
  const magnitudes = new Float32Array(frames * bins), real = new Float64Array(n), imag = new Float64Array(n);
  const window = Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)));
  const read = (frame) => {
    const start = frame * hop - n / 2;
    for (let i = 0; i < n; i++) {
      real[i] = (samples[start + i] ?? 0) * window[i];
      imag[i] = 0;
    }
    fft(real, imag);
  };
  for (let f = 0; f < frames; f++) {
    read(f);
    for (let k = 0; k < bins; k++) magnitudes[f * bins + k] = Math.hypot(real[k], imag[k]);
  }
  const drums = new Float32Array(samples.length), rest = new Float32Array(samples.length), norm = new Float32Array(samples.length), scratch = new Float32Array(9);
  for (let f = 0; f < frames; f++) {
    read(f);
    for (let k = 0; k < bins; k++) {
      for (let d = -4; d <= 4; d++) scratch[d + 4] = magnitudes[Math.max(0, Math.min(frames - 1, f + d)) * bins + k];
      scratch.sort();
      const harmonic = scratch[4];
      for (let d = -4; d <= 4; d++) scratch[d + 4] = magnitudes[f * bins + Math.max(0, Math.min(bins - 1, k + d))];
      scratch.sort();
      const percussive = Math.max(scratch[4], Math.max(0, magnitudes[f * bins + k] - harmonic * 1.5) * 0.7);
      const mask = percussive * percussive / (percussive * percussive + harmonic * harmonic + 1e-16);
      real[k] *= mask;
      imag[k] *= mask;
      if (k > 0 && k < n / 2) {
        real[n - k] *= mask;
        imag[n - k] *= mask;
      }
    }
    fft(real, imag, true);
    const start = f * hop - n / 2;
    for (let i = 0; i < n; i++) {
      const p = start + i;
      if (p >= 0 && p < samples.length) {
        drums[p] += real[i] * window[i];
        norm[p] += window[i] * window[i];
      }
    }
  }
  for (let i = 0; i < samples.length; i++) {
    drums[i] /= Math.max(1e-8, norm[i]);
    rest[i] = samples[i] - drums[i];
  }
  return { drums, rest };
}

// src/tempo.ts
function beatPulse(tempo, time, window = 0.1) {
  if (!tempo || time < tempo.offset || tempo.confidence < 0.24) return { pulse: 0, index: -1 };
  const period = 60 / tempo.bpm;
  const index = Math.floor((time - tempo.offset + 1e-8) / period);
  const age = time - (tempo.offset + index * period);
  return { pulse: age >= -1e-8 && age < window ? 1 : 0, index };
}

// src/signal.ts
var STRIDE = 7;
var silent = () => ({ bands: [0, 0, 0, 0, 0], level: 0, onset: 0 });
function at(signal, seconds) {
  if (!signal || seconds < 0 || seconds >= signal.duration) return silent();
  const index = Math.min(Math.floor(seconds * signal.rate), signal.values.length / STRIDE - 1) * STRIDE;
  return { bands: Array.from(signal.values.subarray(index, index + 5)), level: signal.values[index + 5], onset: signal.values[index + 6] };
}

// src/drums.ts
function detectDrums(signal) {
  const hits2 = [], last = [-1, -1, -1, -1, -1], baseline = [0, 0, 0, 0, 0];
  const kinds = ["kick", "tom", "snare", "hat", "cymbal"];
  for (let frame = 1; frame < signal.values.length / STRIDE; frame++) {
    const p = frame * STRIDE, time = frame / signal.rate;
    const bands = Array.from(signal.values.subarray(p, p + 5));
    const strongest = Math.max(...bands, 1e-3);
    for (let b = 0; b < 5; b++) {
      const rise = bands[b] - baseline[b];
      baseline[b] += (bands[b] - baseline[b]) * 0.12;
      const refractory = b === 3 ? 0.07 : 0.11;
      const attack2 = bands[b] - signal.values[p - STRIDE + b];
      if (bands[b] < 0.16 || bands[b] < strongest * 0.35 || rise < 0.1 || attack2 < 0.035 || time - last[b] < refractory) continue;
      if (b === 1 && bands[0] > bands[1] * 1.3) continue;
      if (b === 4 && bands[4] < bands[3] * 0.95) continue;
      last[b] = time;
      hits2.push({ time, kind: kinds[b], strength: Math.min(1, rise * 2.5), seed: Math.round(time * 1e3) * 2654435761 + b * 1013904223 >>> 0 });
    }
  }
  return hits2.sort((a, b) => a.time - b.time);
}
function recentHits(hits2, time, tail = 0.32, limit = 20) {
  let lo = 0, hi = hits2.length;
  while (lo < hi) {
    const mid = lo + hi >>> 1;
    if (hits2[mid].time <= time) lo = mid + 1;
    else hi = mid;
  }
  const result = [];
  for (let i = lo - 1; i >= 0 && hits2[i].time > time - tail && result.length < limit; i--) result.push(hits2[i]);
  return result;
}
function hitPosition(hit) {
  let seed = hit.seed;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  return { x: 130 + Math.floor(random() * 4) * 15, y: 90 + Math.floor(random() * 4) * 15 };
}

// src/motion.ts
var frameTime = (time, fps = 10) => Math.floor((Math.max(0, time) + 1e-6) * fps) / fps;
var clamp = (value) => Math.max(0, Math.min(1, value));
var valueAt = (signal, time, gain) => {
  const value = at(signal, time);
  return { ...value, bands: value.bands.map((v) => clamp(v * gain)), level: clamp(value.level * gain) };
};
function planFrame(signal, time, gain = 1, options2 = {}) {
  const fps = options2.fps ?? 10;
  time = frameTime(time, fps);
  const now = valueAt(signal, time, gain);
  for (let t = Math.max(0, time - 1 / fps + 1e-3); t < time; t += 1 / 50) {
    const recent = valueAt(signal, t, gain);
    now.onset = Math.max(now.onset, recent.onset);
    now.level = Math.max(now.level, recent.level);
    now.bands = now.bands.map((v, band) => Math.max(v, recent.bands[band]));
  }
  const active = now.level > 0.045;
  const other = options2.otherSignal ?? signal;
  const otherNow = valueAt(other, time, gain);
  const beat = beatPulse(options2.tempo === void 0 ? signal?.tempo : options2.tempo, time, Math.max(1 / fps, 0.09));
  const impact = options2.impact ?? 1;
  const hit = active ? clamp(Math.max(now.onset * 1.8, beat.pulse * 0.85) * impact) : 0;
  const plan = { tiles: [], bars: [], trace: [], rings: 0, pen: 0, eraser: 0, active };
  const tempo = options2.tempo === void 0 ? signal?.tempo : options2.tempo;
  const period = tempo && tempo.confidence >= 0.24 ? 60 / tempo.bpm : 0.42, speed = 15 / period;
  const origin = tempo?.offset ?? 0;
  const latest = Math.floor((time - origin) / period);
  for (let column = latest - 4; !options2.hits && column <= latest; column++) {
    const birth = origin + column * period;
    const feature = valueAt(signal, birth, gain);
    const strongest = Math.max(...feature.bands, 1e-3);
    for (let row = 0; row < 4; row++) {
      const value = feature.bands[3 - row];
      let tone = 0;
      if (value > 0.18 && value > strongest * 0.42 && feature.level > 0.035) {
        tone = value > 0.5 && (value > strongest * 0.82 || feature.onset > 0.2) ? 3 : value > 0.34 ? 2 : 1;
      }
      const lane = now.bands[3 - row];
      if (tone > 0 && hit > 0.48 && lane > 0.15 && (column + row + Math.max(0, beat.index)) % 2 === 0) {
        tone = tone === 3 ? 1 : 3;
      }
      if (tone) plan.tiles.push({ x: Math.round(190 - (time - birth) * speed), y: 90 + row * 15, tone });
    }
  }
  if (options2.hits) {
    plan.tiles = [];
    const transport = Math.round((time - origin) * speed);
    const cells2 = /* @__PURE__ */ new Map();
    for (const event of recentHits(options2.hits, time, 75 / speed, Infinity).reverse()) {
      const position = hitPosition(event);
      const age = time - event.time;
      const column = Math.floor((event.time - origin) / period + 1e-8) + (position.x - 130) / 15;
      const x = 130 + column * 15 - transport;
      if (x + 15 <= 130) continue;
      const envelope = age < 0.1 ? 1 : age < 0.2 ? event.kind === "kick" || event.kind === "tom" ? 0.8 : 0.5 : 0.15;
      const intensity = clamp(event.strength * gain * (0.5 + impact) * envelope);
      const tone = intensity > 0.65 ? 3 : intensity > 0.3 ? 2 : 1;
      cells2.set(`${column},${position.y}`, { x, y: position.y, tone });
    }
    plan.tiles = [...cells2.values()];
    plan.active = plan.tiles.length > 0 || otherNow.level > 0.045;
  }
  if (otherNow.level > 0.045) {
    for (let side = 0; side < 4; side++) for (let p = 0; p < 86; p++) {
      const birth = Math.floor((time - (86 - p) / 32 - side * 0.21) / 0.42) * 0.42;
      const feature = valueAt(other, birth, gain);
      const v = feature.bands[[0, 2, 1, 3][side]];
      const tone = v > 0.5 ? 3 : v > 0.35 ? 2 : v > 0.24 ? 1 : 0;
      if (!tone) continue;
      const point = side === 0 ? [117 + p, 77] : side === 1 ? [200, 77 + p] : side === 2 ? [203 - p, 160] : [117, 163 - p];
      plan.bars.push({ x: point[0], y: point[1], width: side % 2 ? 3 : 1, height: side % 2 ? 1 : 3, tone });
    }
    const ringHit = options2.otherSignal ? clamp(otherNow.onset * 1.8) : hit;
    plan.rings = ringHit > 0.9 ? 3 : ringHit > 0.65 ? 2 : otherNow.bands[3] > 0.7 ? 2 : otherNow.onset > 0.3 ? 1 : 0;
  }
  for (let x = 63; x <= 260; x++) {
    const feature = valueAt(other, time - (260 - x) / 160, gain);
    const strength = clamp(Math.max(0, feature.onset - 0.08) * 1.8 + Math.max(0, feature.bands[3] - 0.4) * 0.3);
    const height = feature.level > 0.035 ? Math.round(Math.max(0, strength - 0.3) * 4) : 0;
    if (height) plan.trace.push({ x, height, tone: strength > 0.4 ? 2 : 3 });
  }
  plan.pen = Math.round(clamp(otherNow.onset * 2) * 2);
  plan.eraser = Math.round(clamp(at(other, time - 197 / 160).onset * 2) * 2);
  return plan;
}

// verify-stems.ts
var input = Float32Array.from({ length: 22050 }, (_, i) => Math.sin(i * 0.063) * 0.3 + (i % 4e3 < 30 ? 0.3 : 0));
assert.equal(frameTime(8.199999809265137), 8.2, "browser seek rounding must not hold the previous frame");
assert.equal(frameTime(8.199), 8.1, "real pre-boundary time stays in its own frame");
var split = separate(input);
for (let i = 0; i < input.length; i++) assert.ok(Number.isFinite(split.drums[i]) && Math.abs(split.drums[i] + split.rest[i] - input[i]) < 1e-6);
var silentSplit = separate(new Float32Array(3e3));
assert.ok(silentSplit.drums.every((v) => v === 0) && silentSplit.rest.every((v) => v === 0));
var silence = { values: new Float32Array(100 * STRIDE), duration: 2, rate: 50, tempo: null };
assert.equal(detectDrums(silence).length, 0);
var steady = { ...silence, values: Float32Array.from(silence.values, (_, i) => i % STRIDE === 0 ? 0.8 : 0) };
assert.ok(detectDrums(steady).length <= 1, "sustained tone must not repeatedly trigger");
var pulses = { ...silence, values: new Float32Array(silence.values.length) };
for (const [frame, band] of [[10, 0], [25, 2], [40, 3]]) pulses.values[frame * STRIDE + band] = 0.9;
assert.deepEqual(detectDrums(pulses).map((h) => h.kind), ["kick", "snare", "hat"]);
var hits = Array.from({ length: 100 }, (_, i) => ({ time: i / 10, kind: "kick", strength: 1, seed: (i + 1) * 2654435761 >>> 0 }));
var cells = /* @__PURE__ */ new Set();
for (const h of hits) {
  const p = hitPosition(h);
  assert.ok(p.x >= 130 && p.x <= 175 && p.y >= 90 && p.y <= 135);
  assert.equal((p.x - 130) % 15, 0);
  assert.equal((p.y - 90) % 15, 0);
  assert.deepEqual(p, hitPosition(h));
  cells.add(`${p.x},${p.y}`);
}
assert.ok(cells.size >= 12, "random hits distributed throughout central grid");
var options = { hits: [{ ...hits[0], time: 0.2 }], otherSignal: silence, fps: 10 };
var attack = planFrame(pulses, 0.21, 1, options);
assert.equal(attack.tiles.length, 1);
assert.equal(attack.bars.length, 0);
assert.equal(attack.trace.length, 0);
assert.deepEqual(attack, planFrame(pulses, 0.29, 1, options), "10 FPS frame hold");
var moved = planFrame(pulses, 0.4, 1, options);
assert.equal(moved.tiles.length, 1);
assert.ok(moved.tiles[0].x < attack.tiles[0].x, "drum ink must move left across frames");
assert.equal(moved.tiles[0].y, attack.tiles[0].y, "row remains fixed");
assert.equal(planFrame(pulses, 2, 1, options).tiles.length, 0, "ink clears after exiting central square");
var rightHit = hits.find((h) => hitPosition(h).x === 175);
var scrolling = { ...options, hits: [{ ...rightHit, time: 0.2 }], tempo: { bpm: 120, offset: 0.2, confidence: 1 } };
assert.equal(planFrame(pulses, 0.7, 1, scrolling).tiles[0].x, 160, "one cell of travel per beat");
assert.equal(planFrame(pulses, 2.1, 1, scrolling).tiles[0].x, 118, "partially visible tile survives at left clip boundary");
assert.equal(planFrame(pulses, 2.2, 1, scrolling).tiles.length, 0, "fully clipped tile removed");
assert.deepEqual(planFrame(pulses, 0.7, 1, scrolling), planFrame(pulses, 0.7, 1, scrolling), "seek is deterministic");
var middleHit = hits.find((h) => hitPosition(h).x === 160 && hitPosition(h).y === hitPosition(rightHit).y);
assert.ok(middleHit);
for (const bpm of [80, 127, 149.75, 180]) {
  const shared = { ...options, tempo: { bpm, offset: 0, confidence: 1 }, hits: [{ ...rightHit, time: 0.013 }, { ...middleHit, time: 0.087 }] };
  const a = planFrame(pulses, 0.1, 1, shared).tiles, b = planFrame(pulses, 0.2, 1, shared).tiles;
  assert.equal(a.length, 2);
  assert.equal(b.length, 2);
  assert.equal(a[0].x - a[1].x, 15, "off-beat hits share exact grid spacing");
  assert.equal(a[0].x - b[0].x, a[1].x - b[1].x, "every tile moves the same pixels per frame");
  const repeated = { ...shared, hits: [{ ...rightHit, time: 0.013 }, { ...rightHit, time: 0.087 }] };
  assert.equal(planFrame(pulses, 0.1, 1, repeated).tiles.length, 1, "same moving cell is re-struck, not layered");
}
assert.equal(planFrame(pulses, 0.2, 1, { hits: [], otherSignal: pulses, tempo: { bpm: 150, offset: 0, confidence: 1 } }).tiles.length, 0, "metronome must not invent drum hits");
console.log(`PASS: complementary separation, silence, attacks, ${cells.size}/16 central cells, frame hold, leftward drum transport, boundary exit and stem isolation`);
