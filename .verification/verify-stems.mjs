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
  const hits = [], last = [-1, -1, -1, -1, -1], baseline = [0, 0, 0, 0, 0];
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
      hits.push({ time, kind: kinds[b], strength: Math.min(1, rise * 2.5), seed: Math.round(time * 1e3) * 2654435761 + b * 1013904223 >>> 0 });
    }
  }
  return hits.sort((a, b) => a.time - b.time);
}
function recentHits(hits, time, tail = 0.32, limit = 20) {
  let lo = 0, hi = hits.length;
  while (lo < hi) {
    const mid = lo + hi >>> 1;
    if (hits[mid].time <= time) lo = mid + 1;
    else hi = mid;
  }
  const result = [];
  for (let i = lo - 1; i >= 0 && hits[i].time > time - tail && result.length < limit; i--) result.push(hits[i]);
  return result;
}

// src/reactive-ink.ts
var clamp = (v) => Math.max(0, Math.min(1, v));
function peakFeature(signal, time, window) {
  const feature = silent();
  if (!signal || time < 0) return feature;
  const last = Math.min(Math.floor(time * signal.rate), Math.ceil(signal.duration * signal.rate) - 1);
  const first = Math.max(0, Math.ceil((time - window) * signal.rate - 1e-6));
  for (let frame = first; frame <= last; frame++) {
    const sample = at(signal, frame / signal.rate + 1e-8);
    feature.level = Math.max(feature.level, sample.level);
    feature.onset = Math.max(feature.onset, sample.onset);
    feature.bands = feature.bands.map((v, band) => Math.max(v, sample.bands[band]));
  }
  return feature;
}
var PERIMETER_SPEED = 32;
function perimeter(drums, other2, time, gain, hold, source = "both", impact = 1) {
  const bars = [];
  const primary = source === "drums" ? drums : other2;
  const now = peakFeature(primary, time, hold);
  const percussion = peakFeature(source === "both" ? drums : void 0, time, hold);
  const level = Math.max(now.level, percussion.level) * gain;
  if (level < 0.045) return { bars, rings: 0 };
  const transport = Math.round(time * PERIMETER_SPEED);
  const bands = [0, 2, 3, 1, 3, 2, 0, 4, 2, 1, 2, 3];
  for (let slot = 0; slot < 12; slot++) {
    const band = bands[slot];
    const delay = slot % 3 * 0.04;
    const sample = peakFeature(primary, time - delay, hold);
    const drum = peakFeature(source === "both" ? drums : void 0, time - delay, hold);
    const energy = clamp(Math.max(sample.bands[band], drum.bands[band] * 0.85) * gain);
    const attack2 = clamp(Math.max(sample.onset * sample.bands[band], drum.onset * drum.bands[band]) * gain * impact);
    const drive = clamp(energy * 0.8 + attack2 * 0.55);
    if (drive < 0.24) continue;
    const tone = drive > 0.62 ? 3 : drive > 0.4 ? 2 : 1;
    const length = drive > 0.78 ? 25 : drive > 0.48 ? 18 : 12;
    const start = Math.round(slot * 86 / 3 - length / 2) - transport;
    for (let i = 0; i < length; i++) {
      const distance = ((start + i) % 344 + 344) % 344;
      const side = Math.floor(distance / 86), p = distance % 86;
      const [x, y] = side === 0 ? [117 + p, 77] : side === 1 ? [200, 77 + p] : side === 2 ? [202 - p, 160] : [117, 162 - p];
      bars.push({ x, y, width: side % 2 ? 3 : 1, height: side % 2 ? 1 : 3, tone, phase: i });
    }
  }
  const accent = clamp(Math.max(now.onset, percussion.onset) * gain * impact);
  return { bars, rings: accent > 0.82 ? 3 : accent > 0.55 ? 2 : accent > 0.28 ? 1 : 0 };
}
var TRACE_SPEED = 160;
var TRACE_START = 262;
var TRACE_END = 63;
var travel = (TRACE_START - TRACE_END) / TRACE_SPEED;
function drumInk(hits, time, gain, hold) {
  const columns = /* @__PURE__ */ new Map();
  let pen = 0, eraser = 0;
  const transport = Math.round(time * TRACE_SPEED);
  for (const hit of recentHits(hits, time, travel + Math.max(hold, 0.15), Infinity)) {
    const age = time - hit.time, strength = clamp(hit.strength * gain);
    if (strength < 0.08) continue;
    const amplitude = hit.kind === "kick" || hit.kind === "tom" ? 3 : hit.kind === "snare" ? 2 : 1;
    const height = Math.max(1, Math.round(amplitude * strength));
    const halfWidth = hit.kind === "cymbal" ? 5 : hit.kind === "kick" || hit.kind === "tom" ? 3 : hit.kind === "snare" ? 2 : 0;
    const x = TRACE_START + Math.round(hit.time * TRACE_SPEED) - transport;
    if (age < Math.max(hold, 0.1)) pen = Math.max(pen, Math.min(2, height));
    if (age >= travel && age < travel + Math.max(hold, 0.1)) eraser = Math.max(eraser, Math.min(2, height));
    for (let dx = -halfWidth; dx <= halfWidth; dx++) {
      const px = x + dx;
      if (px < TRACE_END || px > TRACE_START) continue;
      const h = Math.max(0, height - Math.floor(Math.abs(dx) * height / (halfWidth + 1)));
      const previous = columns.get(px);
      if (!previous || previous.height < h) columns.set(px, { x: px, height: h, tone: halfWidth > 2 ? 2 : 3, phase: dx + halfWidth });
    }
  }
  return { trace: [...columns.values()].sort((a, b) => a.x - b.x), pen, eraser };
}

// src/motion.ts
var frameTime = (time, fps = 10) => Math.floor((Math.max(0, time) + 1e-6) * fps) / fps;
var clamp2 = (value) => Math.max(0, Math.min(1, value));
var valueAt = (signal, time, gain) => {
  const value = at(signal, time);
  return { ...value, bands: value.bands.map((v) => clamp2(v * gain)), level: clamp2(value.level * gain) };
};
var hash = (value) => {
  value = Math.imul(value ^ value >>> 16, 73244475);
  value = Math.imul(value ^ value >>> 16, 73244475);
  return (value ^ value >>> 16) >>> 0;
};
var smoothstep = (value) => {
  value = clamp2(value);
  return value * value * (3 - 2 * value);
};
function smoothedBand(signal, time, band, gain, duration) {
  if (!signal || time < 0) return 0;
  const step = 1 / signal.rate;
  const attack2 = Math.max(step, duration);
  const release = Math.max(step, duration * 1.6);
  const start = Math.max(0, time - Math.max(0.5, release * 4));
  let envelope = 0;
  for (let sampleTime = start; sampleTime <= time + step / 2; sampleTime += step) {
    const frame = Math.min(Math.floor(sampleTime * signal.rate), signal.values.length / STRIDE - 1);
    const target = sampleTime >= signal.duration ? 0 : clamp2((signal.values[frame * STRIDE + band] ?? 0) * gain);
    const tau = target > envelope ? attack2 : release;
    envelope += (target - envelope) * (1 - Math.exp(-step / tau));
  }
  return clamp2(envelope);
}
function kickGate(hits, time, gain, impact, fade) {
  const hold = 0.06;
  let gate = 1;
  for (const hit of recentHits(hits, time, hold + fade, Infinity)) {
    if (hit.kind !== "kick") continue;
    const drive = clamp2(hit.strength * gain * (0.5 + impact));
    const depth = clamp2((drive - 0.55) / 0.35);
    if (!depth) continue;
    const age = time - hit.time;
    const recovery = age <= hold ? 0 : smoothstep((age - hold) / fade);
    gate = Math.min(gate, 1 - depth * (1 - recovery));
  }
  return gate;
}
function historyTiles(other2, hits, time, gain, impact, fade, period, origin) {
  const cells = /* @__PURE__ */ new Map();
  const speed = 15 / period;
  const transport = Math.round((time - origin) * speed);
  const otherGate = kickGate(hits, time, gain, impact, fade);
  const live = Array.from({ length: 5 }, (_, band) => smoothedBand(other2, time, band, gain, fade));
  for (let column = Math.floor(transport / 15); column <= Math.floor(transport / 15) + 4; column++) {
    const x = 130 + column * 15 - transport;
    const birth = origin + (column - 3) * period;
    if (x + 15 <= 130 || x >= 190 || birth < 0 || birth > time) continue;
    const feature = valueAt(other2, birth, gain);
    if (feature.level <= 0.045) continue;
    const signature = feature.bands.reduce((seed, v, band) => seed ^ Math.imul(Math.round(v * 255), 31 ** band), 0);
    for (let row = 0; row < 4; row++) {
      const seed = hash(column * 17 + row * 101 ^ signature);
      const band = seed % 5;
      const threshold = 0.2 + (seed >>> 8) % 35 / 100;
      const amount = smoothstep((feature.bands[band] - threshold) / (1 - threshold));
      const entrance = smoothstep((time - birth + 0.02) / fade);
      const opacity = amount * entrance * (0.65 + live[band] * 0.35) * otherGate;
      if (opacity <= 0.025) continue;
      const cell = `${column},${row}`;
      cells.set(cell, { cell, x, y: 90 + row * 15, tone: amount > 0.72 ? 3 : amount > 0.34 ? 2 : 1, opacity: Number(opacity.toFixed(3)), source: "other" });
    }
  }
  for (const event of recentHits(hits, time, 5 * period, Infinity).reverse()) {
    const seed = hash(event.seed);
    const row = (seed >>> 8) % 4;
    const column = Math.floor((event.time - origin) / period + 1e-8) + seed % 4;
    const x = 130 + column * 15 - transport;
    if (x + 15 <= 130 || x >= 190) continue;
    const age = time - event.time;
    const envelope = 0.12 + 0.88 * smoothstep(1 - Math.max(0, age - 0.08) / fade);
    const amount = clamp2(event.strength * gain * (0.5 + impact)) * envelope;
    if (amount <= 0.025) continue;
    const cell = `${column},${row}`;
    cells.set(cell, { cell, x, y: 90 + row * 15, tone: amount > 0.68 ? 3 : amount > 0.3 ? 2 : 1, opacity: Number(amount.toFixed(3)), source: "drums" });
  }
  return [...cells.values()];
}
function preloadTiles(signal, gain, options2, progress) {
  const fps = options2.fps ?? 10;
  const tempo = options2.tempo === void 0 ? signal.tempo : options2.tempo;
  const period = tempo && tempo.confidence >= 0.24 ? 60 / tempo.bpm : 0.42;
  const origin = tempo?.offset ?? 0, speed = 15 / period;
  const duration = Math.max(signal.duration, options2.otherSignal?.duration ?? 0);
  const other2 = options2.otherSignal ?? signal, hits = options2.hits ?? [];
  const fade = Math.max(0.05, options2.tileFade ?? 0.3), impact = options2.impact ?? 1;
  const cells = /* @__PURE__ */ new Map();
  for (let column = Math.ceil(-origin / period) + 3; origin + (column - 3) * period < duration; column++) {
    const feature = valueAt(other2, origin + (column - 3) * period, gain);
    if (feature.level <= 0.045) continue;
    const signature = feature.bands.reduce((seed, v, band) => seed ^ Math.imul(Math.round(v * 255), 31 ** band), 0);
    for (let row = 0; row < 4; row++) {
      const seed = hash(column * 17 + row * 101 ^ signature), band = seed % 5;
      const threshold = 0.2 + (seed >>> 8) % 35 / 100;
      const weight = smoothstep((feature.bands[band] - threshold) / (1 - threshold));
      if (weight <= 0.025) continue;
      const cell = `${column},${row}`;
      cells.set(cell, { cell, x: 130 + column * 15, y: 90 + row * 15, tone: weight > 0.72 ? 3 : weight > 0.34 ? 2 : 1, source: "other", band, weight });
    }
  }
  for (const event of hits) {
    const seed = hash(event.seed), row = (seed >>> 8) % 4;
    const column = Math.floor((event.time - origin) / period + 1e-8) + seed % 4, cell = `${column},${row}`;
    cells.set(cell, { cell, x: 130 + column * 15, y: 90 + row * 15, tone: 3, source: "drums", kind: event.kind, weight: clamp2(event.strength * gain * (0.5 + impact)) });
  }
  const strip = [...cells.values()], frames = [];
  const count = Math.ceil(duration * fps) + 1;
  for (let index = 0; index < count; index++) {
    const time = index / fps;
    const drums = {};
    for (const hit of recentHits(hits, time, fade + 0.08, Infinity)) {
      const envelope = smoothstep(1 - Math.max(0, time - hit.time - 0.08) / fade);
      drums[hit.kind] = Math.max(drums[hit.kind] ?? 0, clamp2(hit.strength * gain * (0.5 + impact)) * envelope);
    }
    frames.push({ bands: Array.from({ length: 5 }, (_, band) => smoothedBand(other2, time, band, gain, fade)), drums, gate: kickGate(hits, time, gain, impact, fade) });
    if (index % 100 === 0) progress?.(Math.floor(index / count * 100));
  }
  progress?.(100);
  return { strip, frames, fps, speed, origin, duration, tileCount: strip.length };
}
function reactPreloadedStrip(track, time) {
  const reaction = track.frames[Math.floor((time + 1e-6) * track.fps)];
  const transport = Math.round((time - track.origin) * track.speed);
  return track.strip.map((tile) => {
    const drive = tile.source === "other" ? (reaction?.bands[tile.band] ?? 0) * (reaction?.gate ?? 0) : reaction?.drums[tile.kind] ?? 0;
    const amount = tile.weight * drive;
    return { ...tile, x: tile.x - transport, opacity: Number(amount.toFixed(3)), tone: tile.source === "drums" ? amount > 0.68 ? 3 : amount > 0.3 ? 2 : 1 : tile.tone };
  });
}
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
  const other2 = options2.otherSignal ?? signal;
  const otherNow = valueAt(other2, time, gain);
  const beat = beatPulse(options2.tempo === void 0 ? signal?.tempo : options2.tempo, time, Math.max(1 / fps, 0.09));
  const impact = options2.impact ?? 1;
  const tileFade = Math.max(0.05, options2.tileFade ?? 0.3);
  const hit = active ? clamp2(Math.max(now.onset * 1.8, beat.pulse * 0.85) * impact) : 0;
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
    const track = options2.preloadedTiles;
    plan.tiles = track ? reactPreloadedStrip(track, time) : historyTiles(other2, options2.hits, time, gain, impact, tileFade, period, origin);
    plan.active = plan.tiles.some((tile) => tile.x + 15 > 130 && tile.x < 190 && (tile.opacity ?? 1) > 0.025) || otherNow.level > 0.045;
  }
  const border = perimeter(signal, other2, time, gain, Math.max(1 / fps, 0.08), options2.perimeterSource, impact);
  plan.bars = border.bars;
  plan.rings = border.rings;
  plan.active ||= border.bars.length > 0 || border.rings > 0;
  if (options2.hits) {
    Object.assign(plan, drumInk(options2.hits, time, gain, 1 / fps));
    return plan;
  }
  for (let x = 63; x <= 260; x++) {
    const feature = valueAt(signal, time - (260 - x) / 160, gain);
    const strength = clamp2(Math.max(0, feature.onset - 0.08) * 1.8 + Math.max(0, feature.bands[3] - 0.4) * 0.3);
    const height = feature.level > 0.035 ? Math.round(Math.max(0, strength - 0.3) * 4) : 0;
    if (height) plan.trace.push({ x, height, tone: strength > 0.4 ? 2 : 3 });
  }
  plan.pen = Math.round(clamp2(now.onset * 2) * 2);
  plan.eraser = Math.round(clamp2(at(signal, time - 197 / 160).onset * 2) * 2);
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
var other = { ...silence, values: new Float32Array(silence.values.length) };
for (let frame = 0; frame < other.values.length / STRIDE; frame++) {
  for (let band = 0; band < 5; band++) other.values[frame * STRIDE + band] = 0.9;
  other.values[frame * STRIDE + 5] = 0.8;
}
var baseOptions = { hits: [], otherSignal: other, fps: 10, tileFade: 0.3 };
var base = planFrame(pulses, 0.9, 1, baseOptions);
assert.ok(base.tiles.length >= 6, "the non-drum stem holds its assigned tiles");
assert.ok(base.tiles.every((tile) => tile.source === "other"), "an empty hit list cannot invent drum tiles");
assert.ok(base.tiles.every((tile) => tile.x > 115 && tile.x < 190 && tile.y >= 90 && tile.y <= 135), "moving tiles intersect the fixed crop, including partial edge cells");
var kick = { time: 1, kind: "kick", strength: 1, seed: 1 };
var options = { ...baseOptions, hits: [kick], tempo: { bpm: 120, offset: 0, confidence: 1 } };
var attack = planFrame(pulses, 1.01, 1, options);
assert.ok(attack.tiles.some((tile) => tile.source === "drums"), "a kick lights its assigned pads");
assert.equal(attack.tiles.filter((tile) => tile.source === "other").length, 0, "a strong kick switches the held non-drum pads off");
assert.equal(attack.tiles.filter((tile) => tile.source === "drums").length, 1, "one detected hit prints one moving cell");
assert.ok(attack.trace.length > 0, "drum attacks still write pen ink");
assert.deepEqual(attack, planFrame(pulses, 1.099, 1, options), "10 FPS frame hold");
var recovering = planFrame(pulses, 1.2, 1, options).tiles.filter((tile) => tile.source === "other");
assert.ok(recovering.length > 0 && recovering.every((tile) => (tile.opacity ?? 1) < 1), "held pads fade back after the kick blackout");
var fast = planFrame(pulses, 1.3, 1, { ...options, tileFade: 0.1 }).tiles.filter((tile) => tile.source === "other").reduce((sum, tile) => sum + (tile.opacity ?? 1), 0);
var slow = planFrame(pulses, 1.3, 1, { ...options, tileFade: 0.6 }).tiles.filter((tile) => tile.source === "other").reduce((sum, tile) => sum + (tile.opacity ?? 1), 0);
assert.ok(fast > slow, "tile fade duration controls recovery speed");
assert.deepEqual(planFrame(pulses, 1.2, 1, options), planFrame(pulses, 1.2, 1, options), "seek is deterministic");
var metronome = planFrame(pulses, 0.9, 1, { hits: [], otherSignal: other, tempo: { bpm: 150, offset: 0, confidence: 1 } });
assert.ok(metronome.tiles.length > 0 && metronome.tiles.every((tile) => tile.source === "other"), "tempo can time motion but cannot invent drum pads");
console.log("PASS: complementary separation, silence, attacks, stem history, kick ducking, fade recovery and frame hold");
for (const bpm of [80, 127, 149.75, 180]) {
  const scrolling = { ...baseOptions, tempo: { bpm, offset: 0, confidence: 1 } };
  const a = planFrame(pulses, 0.6, 1, scrolling).tiles;
  const b = planFrame(pulses, 0.7, 1, scrolling).tiles;
  const step = Math.round(0.7 * bpm / 4) - Math.round(0.6 * bpm / 4);
  assert.ok(step > 0);
  let compared = 0;
  for (const tile of a) {
    const next = b.find((next2) => next2.cell === tile.cell);
    if (!next) continue;
    compared++;
    assert.equal(next.x, tile.x - step, "surviving cells all move by the same BPM-driven pixel step");
    assert.equal(next.y, tile.y);
    assert.equal(next.tone, tile.tone, "printed texture remains attached to its history cell");
  }
  assert.ok(compared > 0, "test compares actual surviving tiles");
  assert.equal(new Set(b.map((tile) => tile.cell)).size, b.length, "no wrapped copies or overlapping cell identities");
  planFrame(pulses, 1.8, 1, scrolling);
  assert.deepEqual(planFrame(pulses, 0.6, 1, scrolling).tiles, a, "scroll position is independent of seek history");
}
var long = { ...other, duration: 8, values: new Float32Array(8 * 50 * STRIDE) };
long.values.set(other.values);
var historyOptions = { ...baseOptions, otherSignal: long, tempo: { bpm: 120, offset: 0, confidence: 1 } };
var before = planFrame(silence, 1.5, 1, historyOptions).tiles;
var after = planFrame(silence, 3.5, 1, historyOptions).tiles;
assert.ok(before.length > 0);
assert.ok(after.every((tile) => !before.some((old) => old.cell === tile.cell)), "a full crop traversal never recycles departed cells");
assert.equal(planFrame(silence, 5, 1, historyOptions).tiles.length, 0, "silence leaves empty new columns after finite history exits");
var changed = { ...long, values: long.values.slice() };
for (let f = 100; f < 200; f++) {
  changed.values[f * STRIDE + 3] = 1;
  changed.values[f * STRIDE + 5] = 1;
}
assert.notDeepEqual(planFrame(silence, 3.5, 1, { ...historyOptions, otherSignal: changed }).tiles, after, "new audio changes incoming tile content");
assert.deepEqual(planFrame(silence, 1.5, 1, { ...historyOptions, otherSignal: changed }).tiles, before, "future audio cannot rewrite past tiles");
assert.equal(planFrame(silence, 4, 1, { ...options, otherSignal: silence }).tiles.length, 0, "a past drum hit cannot reappear on the right");
console.log("PASS: non-wrapping history, changing audio content, shared transport, fractional BPM, finite lifetime and deterministic seek");
for (const fps of [10, 24]) {
  const sustained = { ...long, values: Float32Array.from(long.values, (_, i) => other.values[i % other.values.length]) };
  const config = { ...options, fps, otherSignal: sustained, hits: [kick, { ...kick, time: 6, seed: 12345 }] };
  const track = preloadTiles(pulses, 1, config);
  assert.equal(track.frames.length, Math.ceil(8 * fps) + 1, "preload covers the entire song");
  assert.ok(track.tileCount > 0);
  const original = JSON.stringify(track);
  const atTime = (time) => planFrame(pulses, time, 1, { ...config, preloadedTiles: track });
  const struck = atTime(1), recovered = atTime(1.3), quiet = atTime(1.6);
  assert.equal(struck.tiles.length, track.strip.length, "all strip tiles have reaction state, not only visible tiles");
  const futureDrum = struck.tiles.find((tile) => tile.source === "drums" && tile.x >= 190 && (tile.opacity ?? 0) > 0);
  assert.ok(futureDrum, "a future offscreen drum tile reacts to the current kick before reaching the crop");
  assert.equal(quiet.tiles.find((tile) => tile.cell === futureDrum.cell)?.opacity, 0, "offscreen drum tile also releases while still hidden");
  const hiddenOther = recovered.tiles.find((tile) => tile.source === "other" && tile.x >= 190 && (tile.opacity ?? 0) > 0);
  assert.ok(hiddenOther, "offscreen rest tiles recover from kick ducking on the shared clock");
  assert.equal(struck.tiles.find((tile) => tile.cell === hiddenOther.cell)?.opacity, 0, "kick ducks the offscreen rest tile");
  assert.deepEqual(atTime(1), struck, "full-strip reactions are deterministic after seeking");
  assert.equal(JSON.stringify(track), original, "playback does not mutate preloaded world positions");
}
console.log("PASS: full-strip preload, offscreen/future tile reactions, kick/recovery, 10/24 FPS and immutable strip playback");
