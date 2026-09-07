// verify-motion.ts
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
      const a2 = novelty[i], b2 = novelty[j] * (1 - f) + novelty[j + 1] * f;
      sum += a2 * b2;
      aPower += a2 * a2;
      bPower += b2 * b2;
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
function beatPulse(tempo, time, window = 0.1) {
  if (!tempo || time < tempo.offset || tempo.confidence < 0.24) return { pulse: 0, index: -1 };
  const period = 60 / tempo.bpm;
  const index = Math.floor((time - tempo.offset + 1e-8) / period);
  const age = time - (tempo.offset + index * period);
  return { pulse: age >= -1e-8 && age < window ? 1 : 0, index };
}

// src/signal.ts
var RATE = 50;
var STRIDE = 7;
var silent = () => ({ bands: [0, 0, 0, 0, 0], level: 0, onset: 0 });
function analyse(samples, sampleRate, spectral = false) {
  const n = 2048, count = Math.ceil(samples.length / sampleRate * RATE);
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
      const sample = samples[start + i] ?? 0;
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
          const a2 = start2 + j, b2 = a2 + length / 2;
          const tr = real[b2] * ur - imaginary[b2] * ui, ti = real[b2] * ui + imaginary[b2] * ur;
          real[b2] = real[a2] - tr;
          imaginary[b2] = imaginary[a2] - ti;
          real[a2] += tr;
          imaginary[a2] += ti;
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
  const levels = Array.from({ length: count }, (_, i) => values[i * STRIDE + 5]).sort((a2, b2) => a2 - b2);
  const reference = Math.max(0.015, levels[Math.floor(count * 0.95)] ?? 0);
  if (spectrum) for (let i = 0; i < spectrum.values.length; i++) spectrum.values[i] /= (reference * 0.58) ** 2;
  let baseline2 = 0, envelope = 0;
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
    envelope = Math.max(flux * 4, Math.max(0, level - baseline2 - 0.08), envelope * 0.76);
    baseline2 += (level - baseline2) * 0.14;
    values[offset + 5] = level;
    values[offset + 6] = Math.min(1, envelope);
  }
  return { values, duration: samples.length / sampleRate, rate: RATE, tempo: detectTempo(values, RATE, STRIDE), spectrum };
}
function at(signal2, seconds) {
  if (!signal2 || seconds < 0 || seconds >= signal2.duration) return silent();
  const index = Math.min(Math.floor(seconds * signal2.rate), signal2.values.length / STRIDE - 1) * STRIDE;
  return { bands: Array.from(signal2.values.subarray(index, index + 5)), level: signal2.values[index + 5], onset: signal2.values[index + 6] };
}

// src/drums.ts
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

// src/reactive-ink.ts
var clamp = (v) => Math.max(0, Math.min(1, v));
function peakFeature(signal2, time, window) {
  const feature = silent();
  if (!signal2 || time < 0) return feature;
  const last = Math.min(Math.floor(time * signal2.rate), Math.ceil(signal2.duration * signal2.rate) - 1);
  const first = Math.max(0, Math.ceil((time - window) * signal2.rate - 1e-6));
  for (let frame = first; frame <= last; frame++) {
    const sample = at(signal2, frame / signal2.rate + 1e-8);
    feature.level = Math.max(feature.level, sample.level);
    feature.onset = Math.max(feature.onset, sample.onset);
    feature.bands = feature.bands.map((v, band) => Math.max(v, sample.bands[band]));
  }
  return feature;
}
var PERIMETER_SPEED = 32;
function perimeter(drums, other, time, gain, hold, source2 = "both", impact = 1) {
  const bars = [];
  const primary = source2 === "drums" ? drums : other;
  const now = peakFeature(primary, time, hold);
  const percussion = peakFeature(source2 === "both" ? drums : void 0, time, hold);
  const level = Math.max(now.level, percussion.level) * gain;
  if (level < 0.045) return { bars, rings: 0 };
  const transport = Math.round(time * PERIMETER_SPEED);
  const bands = [0, 2, 3, 1, 3, 2, 0, 4, 2, 1, 2, 3];
  for (let slot = 0; slot < 12; slot++) {
    const band = bands[slot];
    const delay = slot % 3 * 0.04;
    const sample = peakFeature(primary, time - delay, hold);
    const drum = peakFeature(source2 === "both" ? drums : void 0, time - delay, hold);
    const energy = clamp(Math.max(sample.bands[band], drum.bands[band] * 0.85) * gain);
    const attack = clamp(Math.max(sample.onset * sample.bands[band], drum.onset * drum.bands[band]) * gain * impact);
    const drive = clamp(energy * 0.8 + attack * 0.55);
    if (drive < 0.24) continue;
    const tone2 = drive > 0.62 ? 3 : drive > 0.4 ? 2 : 1;
    const length = drive > 0.78 ? 25 : drive > 0.48 ? 18 : 12;
    const start = Math.round(slot * 86 / 3 - length / 2) - transport;
    for (let i = 0; i < length; i++) {
      const distance = ((start + i) % 344 + 344) % 344;
      const side = Math.floor(distance / 86), p = distance % 86;
      const [x, y] = side === 0 ? [117 + p, 77] : side === 1 ? [200, 77 + p] : side === 2 ? [202 - p, 160] : [117, 162 - p];
      bars.push({ x, y, width: side % 2 ? 3 : 1, height: side % 2 ? 1 : 3, tone: tone2, phase: i });
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
  return { trace: [...columns.values()].sort((a2, b2) => a2.x - b2.x), pen, eraser };
}

// src/motion.ts
var frameTime = (time, fps = 10) => Math.floor((Math.max(0, time) + 1e-6) * fps) / fps;
var clamp2 = (value) => Math.max(0, Math.min(1, value));
var valueAt = (signal2, time, gain) => {
  const value = at(signal2, time);
  return { ...value, bands: value.bands.map((v) => clamp2(v * gain)), level: clamp2(value.level * gain) };
};
function planFrame(signal2, time, gain = 1, options = {}) {
  const fps = options.fps ?? 10;
  time = frameTime(time, fps);
  const now = valueAt(signal2, time, gain);
  for (let t = Math.max(0, time - 1 / fps + 1e-3); t < time; t += 1 / 50) {
    const recent = valueAt(signal2, t, gain);
    now.onset = Math.max(now.onset, recent.onset);
    now.level = Math.max(now.level, recent.level);
    now.bands = now.bands.map((v, band) => Math.max(v, recent.bands[band]));
  }
  const active = now.level > 0.045;
  const other = options.otherSignal ?? signal2;
  const otherNow = valueAt(other, time, gain);
  const beat = beatPulse(options.tempo === void 0 ? signal2?.tempo : options.tempo, time, Math.max(1 / fps, 0.09));
  const impact = options.impact ?? 1;
  const hit = active ? clamp2(Math.max(now.onset * 1.8, beat.pulse * 0.85) * impact) : 0;
  const plan = { tiles: [], bars: [], trace: [], rings: 0, pen: 0, eraser: 0, active };
  const tempo = options.tempo === void 0 ? signal2?.tempo : options.tempo;
  const period = tempo && tempo.confidence >= 0.24 ? 60 / tempo.bpm : 0.42, speed = 15 / period;
  const origin = tempo?.offset ?? 0;
  const latest = Math.floor((time - origin) / period);
  for (let column = latest - 4; !options.hits && column <= latest; column++) {
    const birth = origin + column * period;
    const feature = valueAt(signal2, birth, gain);
    const strongest = Math.max(...feature.bands, 1e-3);
    for (let row = 0; row < 4; row++) {
      const value = feature.bands[3 - row];
      let tone2 = 0;
      if (value > 0.18 && value > strongest * 0.42 && feature.level > 0.035) {
        tone2 = value > 0.5 && (value > strongest * 0.82 || feature.onset > 0.2) ? 3 : value > 0.34 ? 2 : 1;
      }
      const lane = now.bands[3 - row];
      if (tone2 > 0 && hit > 0.48 && lane > 0.15 && (column + row + Math.max(0, beat.index)) % 2 === 0) {
        tone2 = tone2 === 3 ? 1 : 3;
      }
      if (tone2) plan.tiles.push({ x: Math.round(190 - (time - birth) * speed), y: 90 + row * 15, tone: tone2 });
    }
  }
  if (options.hits) {
    plan.tiles = [];
    const transport = Math.round((time - origin) * speed);
    const cells = /* @__PURE__ */ new Map();
    for (const event of recentHits(options.hits, time, 75 / speed, Infinity).reverse()) {
      const position = hitPosition(event);
      const age = time - event.time;
      const column = Math.floor((event.time - origin) / period + 1e-8) + (position.x - 130) / 15;
      const x = 130 + column * 15 - transport;
      if (x + 15 <= 130) continue;
      const envelope = age < 0.1 ? 1 : age < 0.2 ? event.kind === "kick" || event.kind === "tom" ? 0.8 : 0.5 : 0.15;
      const intensity = clamp2(event.strength * gain * (0.5 + impact) * envelope);
      const tone2 = intensity > 0.65 ? 3 : intensity > 0.3 ? 2 : 1;
      cells.set(`${column},${position.y}`, { x, y: position.y, tone: tone2 });
    }
    plan.tiles = [...cells.values()];
    plan.active = plan.tiles.length > 0 || otherNow.level > 0.045;
  }
  const border = perimeter(signal2, other, time, gain, Math.max(1 / fps, 0.08), options.perimeterSource, impact);
  plan.bars = border.bars;
  plan.rings = border.rings;
  plan.active ||= border.bars.length > 0 || border.rings > 0;
  if (options.hits) {
    Object.assign(plan, drumInk(options.hits, time, gain, 1 / fps));
    return plan;
  }
  for (let x = 63; x <= 260; x++) {
    const feature = valueAt(signal2, time - (260 - x) / 160, gain);
    const strength = clamp2(Math.max(0, feature.onset - 0.08) * 1.8 + Math.max(0, feature.bands[3] - 0.4) * 0.3);
    const height = feature.level > 0.035 ? Math.round(Math.max(0, strength - 0.3) * 4) : 0;
    if (height) plan.trace.push({ x, height, tone: strength > 0.4 ? 2 : 3 });
  }
  plan.pen = Math.round(clamp2(now.onset * 2) * 2);
  plan.eraser = Math.round(clamp2(at(signal2, time - 197 / 160).onset * 2) * 2);
  return plan;
}

// verify-motion.ts
var rate = 22050;
var tone = (hz, duration = 2) => Float32Array.from({ length: rate * duration }, (_, i) => 0.18 * Math.sin(i / rate * Math.PI * 2 * hz));
for (const [hz, expected] of [[90, 0], [300, 1], [900, 2], [5e3, 3], [9500, 4]]) {
  const signal2 = analyse(tone(hz), rate), feature = at(signal2, 1);
  assert(feature.bands[expected] > 0.7, `${hz} Hz must activate its band`);
  assert(feature.bands.filter((_, i) => i !== expected).every((v) => v < 0.08), `${hz} Hz must not activate unrelated bands`);
  assert(Array.from(signal2.values).every((v) => Number.isFinite(v) && v >= 0 && v <= 1));
}
var silent2 = analyse(new Float32Array(rate * 2), rate);
assert(silent2.values.every((v) => v === 0), "silence must remain zero");
assert.equal(planFrame(silent2, 1).active, false);
assert.equal(planFrame(silent2, 1).trace.length, 0);
var source = new Float32Array(rate * 4);
source.set(tone(900, 1));
var signal = analyse(source, rate);
var baseline = planFrame(signal, 0.9);
for (let t = 0; t < 4; t += 1 / 144) planFrame(signal, t);
assert.deepEqual(planFrame(signal, 0.9), baseline, "history/refresh-rate independent seeking");
assert.deepEqual(planFrame(signal, 0.9), planFrame(signal, 0.9), "pause must freeze");
assert.deepEqual(planFrame(signal, 0.901), planFrame(signal, 0.999), "10 FPS holds one complete frame for 100 ms");
var a = planFrame(signal, 0.6, 1, { impact: 0 }).tiles;
var b = planFrame(signal, 0.7, 1, { impact: 0 }).tiles;
assert(a.length > 0 && a.length === b.length);
assert(b.every((tile, i) => tile.x < a[i].x && tile.y === a[i].y && tile.tone === a[i].tone), "printed cells retain their shape while travelling left");
assert(planFrame(signal, 1.1).trace.length > 0, "ink outlives present signal");
assert.equal(planFrame(signal, 3).trace.length, 0, "finite history clears in silence");
assert.equal(planFrame(signal, 3).active, false);
assert.equal(signal.values.length % STRIDE, 0);
assert.deepEqual(at(signal, -1).bands, [0, 0, 0, 0, 0]);
console.log("PASS: 5 spectral bands, silence, finite values, deterministic seek/pause, leftward cell transport, ink tail and clear.");
for (const expected of [80, 100, 120, 127, 150, 180]) {
  const values = new Float32Array(50 * 24 * STRIDE), period = 60 / expected, offset = 0.23;
  for (let t = offset; t < 24; t += period) {
    const i = Math.round(t * 50);
    for (let j = 0; j < 4; j++) if ((i + j) * STRIDE + 6 < values.length) {
      values[(i + j) * STRIDE + 6] = Math.exp(-j);
      values[(i + j) * STRIDE] = Math.exp(-j);
      values[(i + j) * STRIDE + 5] = Math.exp(-j);
    }
  }
  const tempo = detectTempo(values, 50, STRIDE);
  console.log("tempo fixture", expected, tempo);
  assert(tempo && Math.abs(tempo.bpm - expected) < 1.1, `${expected} BPM recovery`);
  const phaseError = Math.abs((tempo.offset - offset + period * 1.5) % period - period / 2);
  assert(phaseError < 0.055, "beat phase within analysis hop aperture");
}
assert.equal(detectTempo(new Float32Array(50 * 10 * STRIDE), 50, STRIDE), null);
var fake = { values: new Float32Array(50 * 4 * STRIDE), duration: 4, rate: 50, tempo: { bpm: 120, offset: 0.23, confidence: 1 } };
for (let i = 0; i < 200; i++) {
  fake.values[i * STRIDE] = 0.8;
  fake.values[i * STRIDE + 2] = 0.65;
  fake.values[i * STRIDE + 5] = 0.8;
}
var flash = planFrame(fake, 1.3, 1, { impact: 1 });
var off = planFrame(fake, 1.3, 1, { impact: 0 });
assert.notDeepEqual(flash.tiles, off.tiles, "beat changes ink tones even for already present tiles");
assert.deepEqual(flash.tiles.map((t) => [t.x, t.y]), off.tiles.map((t) => [t.x, t.y]), "beat does not scale or move tiles");
assert.equal(beatPulse(fake.tempo, 1.3).pulse, 1);
assert.equal(beatPulse(fake.tempo, 1.5).pulse, 0);
assert.equal(frameTime(1.299), 1.2);
assert.deepEqual(planFrame(fake, 1.301), planFrame(fake, 1.399));
console.log("PASS: automatic BPM/phase, no tempo in silence, 10 FPS hold, beat-synchronous ink flash with unchanged geometry.");
