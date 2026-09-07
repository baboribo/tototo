import { at, silent, type Signal } from './signal';
import { recentHits, type DrumHit } from './drums';

export type InkBar = { x: number; y: number; width: number; height: number; tone: number; phase: number };
export type InkMark = { x: number; height: number; tone: number; phase?: number };
export type PerimeterSource = 'both' | 'drums' | 'other';
const clamp = (v: number) => Math.max(0, Math.min(1, v));

/** Causal peak hold: a short attack survives a coarse visual frame, never leads it. */
export function peakFeature(signal: Signal | undefined, time: number, window: number) {
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

export const PERIMETER_SPEED = 32;

/** Fixed square path; the printed fragments travel, their audio gates do not rotate the square. */
export function perimeter(drums: Signal | undefined, other: Signal | undefined, time: number, gain: number, hold: number, source: PerimeterSource = 'both', impact = 1) {
  const bars: InkBar[] = [];
  const primary = source === 'drums' ? drums : other;
  const now = peakFeature(primary, time, hold);
  const percussion = peakFeature(source === 'both' ? drums : undefined, time, hold);
  const level = Math.max(now.level, percussion.level) * gain;
  if (level < 0.045) return { bars, rings: 0 };
  // One shared integer transport prevents fragments from drifting apart. Moving
  // through a corner splits a single printed fragment across its two edges.
  const transport = Math.round(time * PERIMETER_SPEED);
  // Spectral lanes and short past windows give each piece a different response.
  const bands = [0, 2, 3, 1, 3, 2, 0, 4, 2, 1, 2, 3];
  for (let slot = 0; slot < 12; slot++) {
    const band = bands[slot];
    const delay = (slot % 3) * 0.04;
    const sample = peakFeature(primary, time - delay, hold);
    const drum = peakFeature(source === 'both' ? drums : undefined, time - delay, hold);
    const energy = clamp(Math.max(sample.bands[band], drum.bands[band] * 0.85) * gain);
    const attack = clamp(Math.max(sample.onset * sample.bands[band], drum.onset * drum.bands[band]) * gain * impact);
    const drive = clamp(energy * 0.8 + attack * 0.55);
    if (drive < 0.24) continue;
    const tone = drive > 0.62 ? 3 : drive > 0.4 ? 2 : 1;
    // Quantized lengths keep a printed, cut-up contour even under sustained audio.
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

export const TRACE_SPEED = 160;
export const TRACE_START = 262;
export const TRACE_END = 63;
const travel = (TRACE_START - TRACE_END) / TRACE_SPEED;

/** One mark per detected attack, carried unchanged from nib to eraser. */
export function drumInk(hits: DrumHit[], time: number, gain: number, hold: number) {
  const columns = new Map<number, InkMark>();
  let pen = 0, eraser = 0;
  const transport = Math.round(time * TRACE_SPEED);
  for (const hit of recentHits(hits, time, travel + Math.max(hold, 0.15), Infinity)) {
    const age = time - hit.time, strength = clamp(hit.strength * gain);
    if (strength < 0.08) continue;
    const amplitude = hit.kind === 'kick' || hit.kind === 'tom' ? 3 : hit.kind === 'snare' ? 2 : 1;
    const height = Math.max(1, Math.round(amplitude * strength));
    const halfWidth = hit.kind === 'cymbal' ? 5 : hit.kind === 'kick' || hit.kind === 'tom' ? 3 : hit.kind === 'snare' ? 2 : 0;
    const x = TRACE_START + Math.round(hit.time * TRACE_SPEED) - transport;
    if (age < Math.max(hold, 0.1)) pen = Math.max(pen, Math.min(2, height));
    // Erasing reacts when that same printed mark arrives, not to a new beat.
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
