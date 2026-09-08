import { at, STRIDE, type Signal } from './signal';
import { beatPulse, type Tempo } from './tempo';
import { recentHits, type DrumHit, type DrumKind } from './drums';
import { perimeter, drumInk, type InkBar, type InkMark, type PerimeterSource } from './reactive-ink';

export type MotionOptions = { fps?: number; impact?: number; tileFade?: number; tempo?: Tempo | null; hits?: DrumHit[]; otherSignal?: Signal; perimeterSource?: PerimeterSource };
// Browser range/media values may land fractions of a microsecond below a frame.
export const frameTime = (time: number, fps = 10) => Math.floor((Math.max(0, time) + 1e-6) * fps) / fps;

export type Tile = { x: number; y: number; tone: number; opacity?: number; source?: 'drums' | 'other' };
export type FramePlan = { tiles: Tile[]; bars: InkBar[]; trace: InkMark[]; rings: number; pen: number; eraser: number; active: boolean };
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const valueAt = (signal: Signal | undefined, time: number, gain: number) => {
  const value = at(signal, time);
  return { ...value, bands: value.bands.map(v => clamp(v * gain)), level: clamp(value.level * gain) };
};

type TileBinding =
  | { source: 'other'; band: number; threshold: number; fadeScale: number }
  | { source: 'drums'; kind: DrumKind };

// Fixed 4x4 routing. The reference reads more like a bank of assigned pads than
// a random hit printer: sustained musical material holds the "other" pads while
// each percussion family reuses its own locations.
const tileBindings: TileBinding[] = [
  { source: 'other', band: 3, threshold: 0.24, fadeScale: 0.8 }, { source: 'drums', kind: 'hat' },   { source: 'other', band: 2, threshold: 0.2, fadeScale: 1.1 }, { source: 'drums', kind: 'snare' },
  { source: 'drums', kind: 'kick' },   { source: 'other', band: 1, threshold: 0.22, fadeScale: 1 }, { source: 'other', band: 3, threshold: 0.3, fadeScale: 1.25 }, { source: 'drums', kind: 'tom' },
  { source: 'other', band: 0, threshold: 0.2, fadeScale: 1.2 }, { source: 'drums', kind: 'kick' },   { source: 'other', band: 4, threshold: 0.2, fadeScale: 0.75 }, { source: 'drums', kind: 'hat' },
  { source: 'drums', kind: 'cymbal' }, { source: 'other', band: 2, threshold: 0.28, fadeScale: 0.9 }, { source: 'drums', kind: 'snare' }, { source: 'other', band: 0, threshold: 0.3, fadeScale: 1.35 },
];

const smoothstep = (value: number) => {
  value = clamp(value);
  return value * value * (3 - 2 * value);
};

/** Rebuild a causal attack/release envelope from analysis history. */
function smoothedBand(signal: Signal | undefined, time: number, band: number, gain: number, duration: number) {
  if (!signal || time < 0) return 0;
  const step = 1 / signal.rate;
  const attack = Math.max(step, duration);
  const release = Math.max(step, duration * 1.6);
  const start = Math.max(0, time - Math.max(0.5, release * 4));
  let envelope = 0;
  for (let sampleTime = start; sampleTime <= time + step / 2; sampleTime += step) {
    const frame = Math.min(Math.floor(sampleTime * signal.rate), signal.values.length / STRIDE - 1);
    const target = clamp((signal.values[frame * STRIDE + band] ?? 0) * gain);
    const tau = target > envelope ? attack : release;
    envelope += (target - envelope) * (1 - Math.exp(-step / tau));
  }
  return clamp(envelope);
}

function kickGate(hits: DrumHit[], time: number, gain: number, impact: number, fade: number) {
  const hold = 0.06;
  let gate = 1;
  for (const hit of recentHits(hits, time, hold + fade, Infinity)) {
    if (hit.kind !== 'kick') continue;
    const drive = clamp(hit.strength * gain * (0.5 + impact));
    const depth = clamp((drive - 0.55) / 0.35);
    if (!depth) continue;
    const age = time - hit.time;
    const recovery = age <= hold ? 0 : smoothstep((age - hold) / fade);
    gate = Math.min(gate, 1 - depth * (1 - recovery));
  }
  return gate;
}

function assignedTiles(other: Signal | undefined, hits: DrumHit[], time: number, gain: number, impact: number, fade: number) {
  const tiles: Tile[] = [];
  const otherGate = kickGate(hits, time, gain, impact, fade);
  const recent = recentHits(hits, time, fade + 0.12, Infinity);
  tileBindings.forEach((binding, index) => {
    const x = 130 + index % 4 * 15;
    const y = 90 + Math.floor(index / 4) * 15;
    if (binding.source === 'other') {
      const level = smoothedBand(other, time, binding.band, gain, fade * binding.fadeScale);
      const amount = smoothstep((level - binding.threshold) / Math.max(0.05, 0.82 - binding.threshold));
      const opacity = amount * otherGate;
      if (opacity > 0.025) tiles.push({ x, y, tone: amount > 0.72 ? 3 : amount > 0.34 ? 2 : 1, opacity: Number(opacity.toFixed(3)), source: 'other' });
      return;
    }
    let amount = 0;
    for (const hit of recent) {
      if (hit.kind !== binding.kind) continue;
      const age = time - hit.time;
      const envelope = age <= 0.08 ? 1 : smoothstep(1 - (age - 0.08) / fade);
      amount = Math.max(amount, clamp(hit.strength * gain * (0.5 + impact)) * envelope);
    }
    if (amount > 0.025) tiles.push({ x, y, tone: amount > 0.68 ? 3 : amount > 0.3 ? 2 : 1, opacity: Number(amount.toFixed(3)), source: 'drums' });
  });
  return tiles;
}

/** Pure time→geometry mapping: seeking and display refresh rate cannot alter it. */
export function planFrame(signal: Signal | undefined, time: number, gain = 1, options: MotionOptions = {}): FramePlan {
  const fps = options.fps ?? 10;
  time = frameTime(time, fps);
  const now = valueAt(signal, time, gain);
  // Preserve transients that land between two coarse visual frames.
  for (let t = Math.max(0, time - 1 / fps + 0.001); t < time; t += 1 / 50) {
    const recent = valueAt(signal, t, gain);
    now.onset = Math.max(now.onset, recent.onset);
    now.level = Math.max(now.level, recent.level);
    now.bands = now.bands.map((v, band) => Math.max(v, recent.bands[band]));
  }
  const active = now.level > 0.045;
  const other = options.otherSignal ?? signal;
  const otherNow = valueAt(other,time,gain);
  const beat = beatPulse(options.tempo === undefined ? signal?.tempo : options.tempo, time, Math.max(1 / fps, 0.09));
  const impact = options.impact ?? 1;
  const tileFade = Math.max(0.05, options.tileFade ?? 0.3);
  const hit = active ? clamp(Math.max(now.onset * 1.8, beat.pulse * 0.85) * impact) : 0;
  const plan: FramePlan = { tiles: [], bars: [], trace: [], rings: 0, pen: 0, eraser: 0, active };
  // Past samples carry the printed pattern; present beat/onsets overprint selected
  // cells for one held frame. Geometry stays fixed while ink tone flashes.
  const tempo = options.tempo === undefined ? signal?.tempo : options.tempo;
  const period = tempo && tempo.confidence >= 0.24 ? 60 / tempo.bpm : 0.42, speed = 15 / period;
  const origin = tempo?.offset ?? 0;
  const latest = Math.floor((time - origin) / period);
  for (let column = latest - 4; !options.hits && column <= latest; column++) {
    const birth = origin + column * period;
    const feature = valueAt(signal, birth, gain);
    const strongest = Math.max(...feature.bands, 0.001);
    for (let row = 0; row < 4; row++) {
      const value = feature.bands[3 - row];
      let tone = 0;
      if (value > 0.18 && value > strongest * 0.42 && feature.level > 0.035) {
        tone = value > 0.5 && (value > strongest * 0.82 || feature.onset > 0.2) ? 3 : value > 0.34 ? 2 : 1;
      }
      const lane = now.bands[3 - row];
      if (tone > 0 && hit > 0.48 && lane > 0.15 && ((column + row + Math.max(0, beat.index)) % 2 === 0)) {
        tone = tone === 3 ? 1 : 3;
      }
      if (tone) plan.tiles.push({ x: Math.round(190 - (time - birth) * speed), y: 90 + row * 15, tone });
    }
  }
  if(options.hits) {
    plan.tiles = assignedTiles(other, options.hits, time, gain, impact, tileFade);
    plan.active=plan.tiles.length>0||otherNow.level>0.045;
  }
  const border = perimeter(signal, other, time, gain, Math.max(1 / fps, 0.08), options.perimeterSource, impact);
  plan.bars = border.bars;
  plan.rings = border.rings;
  plan.active ||= border.bars.length > 0 || border.rings > 0;
  if (options.hits) {
    Object.assign(plan, drumInk(options.hits, time, gain, 1 / fps));
    return plan;
  }
  // Pen tip writes at the right; the same amplitude history reaches the eraser
  // later. Continuous columns produce irregular connected marks, not bobbing dots.
  for (let x = 63; x <= 260; x++) {
    const feature = valueAt(signal, time - (260 - x) / 160, gain);
    const strength = clamp(Math.max(0, feature.onset - 0.08) * 1.8 + Math.max(0, feature.bands[3] - 0.4) * 0.3);
    const height = feature.level > 0.035 ? Math.round(Math.max(0, strength - 0.3) * 4) : 0;
    if (height) plan.trace.push({ x, height, tone: strength > 0.4 ? 2 : 3 });
  }
  plan.pen = Math.round(clamp(now.onset * 2) * 2);
  plan.eraser = Math.round(clamp(at(signal, time - 197 / 160).onset * 2) * 2);
  return plan;
}

export class MotionRenderer {
  private surface = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private output: CanvasRenderingContext2D;
  private paper = '#cbcfc5';
  private ink = '#2b2e27';
  constructor(private canvas: HTMLCanvasElement) {
    this.surface.width = 320; this.surface.height = 240;
    this.ctx = this.surface.getContext('2d', { alpha: false })!;
    this.output = canvas.getContext('2d', { alpha: false })!;
  }
  private rect(x: number, y: number, width: number, height: number, color = this.ink) {
    this.ctx.fillStyle = color; this.ctx.fillRect(Math.round(x), Math.round(y), width, height);
  }
  private texture(x: number, y: number, width: number, height: number, tone: number) {
    if (tone === 3) { this.rect(x, y, width, height); return; }
    for (let yy = 0; yy < height; yy++) for (let xx = 0; xx < width; xx++) {
      // Texture is anchored to the printed cell, and travels with it.
      const dark = tone === 2 ? ((xx + yy) % 3 !== 0 && (xx - yy + 300) % 3 !== 0) : (xx % 3 === 1 && yy % 3 === 1);
      if (dark) this.rect(x + xx, y + yy, 1, 1);
    }
  }
  private dottedBox(x: number, y: number, size: number) {
    for (let n = 0; n <= size; n += 3) { this.rect(x + n, y, 1, 1); this.rect(x + n, y + size, 1, 1); this.rect(x, y + n, 1, 1); this.rect(x + size, y + n, 1, 1); }
  }
  render(signal: Signal | undefined, time: number, gain = 1, caption = '', options: MotionOptions = {}) {
    time = frameTime(time, options.fps ?? 10);
    const plan = planFrame(signal, time, gain, options), ctx = this.ctx;
    this.rect(0, 0, 320, 240, this.paper);
    if (plan.active || !signal || time === 0) {
      ctx.save(); ctx.beginPath(); ctx.rect(130, 90, 60, 60); ctx.clip();
      for (const tile of plan.tiles) {
        ctx.save(); ctx.globalAlpha = tile.opacity ?? 1;
        this.texture(tile.x, tile.y, 15, 15, tile.tone);
        ctx.restore();
      }
      ctx.restore(); this.dottedBox(130, 90, 60);
      for (let ring = 0; ring < plan.rings; ring++) this.dottedBox(127 - ring * 3, 87 - ring * 3, 66 + ring * 6);
      if (plan.rings === 3) { this.dottedBox(125, 85, 70); this.dottedBox(123, 83, 74); }
      for (const bar of plan.bars) for (let yy = 0; yy < bar.height; yy++) for (let xx = 0; xx < bar.width; xx++) {
        const x = bar.x + xx, y = bar.y + yy;
        const across = bar.width === 3 ? xx : yy;
        if (bar.tone === 3 || (bar.tone === 2 ? (bar.phase + across) % 3 !== 0 : bar.phase % 3 === 0 && across === 1)) this.rect(x, y, 1, 1);
      }
    }
    for (const mark of plan.trace) for (let y = -mark.height; y <= mark.height; y++) {
      const phase = mark.phase ?? mark.x + Math.floor(time * 160);
      if (mark.tone === 3 || (phase + y + 1000) % 3 !== 0) this.rect(mark.x, 176 + y, 1, 1);
    }
    // Eraser: stippled rubber block with an outlined unfilled cap.
    const ey = 184 - plan.eraser;
    this.rect(55, ey, 15, 18); this.texture(56, ey + 1, 13, 16, 2);
    for (let y = ey + 1; y < ey + 17; y += 3) for (let x = 56; x < 69; x += 3) this.rect(x, y, 1, 1, '#59604f');
    this.rect(56, ey - 5, 1, 5); this.rect(68, ey - 3, 1, 3);
    for (let x = 57; x < 68; x += 3) this.rect(x, ey - 5, 2, 1);
    // Upward pointed nib, split down the centre; short stippled holder below.
    const py = 180 - plan.pen;
    this.rect(262, py, 1, 11);
    for (let i = 0; i < 7; i++) { this.rect(262 - i, py + 2 + i * 2, 1, 1); this.rect(262 + i, py + 2 + i * 2, 1, 1); }
    this.rect(256, py + 15, 3, 1); this.rect(266, py + 15, 3, 1);
    this.rect(257, py + 17, 11, 6);
    for (let x = 258; x < 268; x += 3) this.rect(x, py + 18, 1, 1, this.paper);
    if (caption.trim() && plan.active) {
      ctx.fillStyle = '#8f9787'; ctx.font = '10px serif'; ctx.textAlign = 'center';
      [...caption.trim().slice(0, 20)].forEach((char, i) => ctx.fillText(char, 282, 62 + i * 9));
    }
    this.output.imageSmoothingEnabled = false;
    this.output.drawImage(this.surface, 0, 0, this.canvas.width, this.canvas.height);
    return plan;
  }
}
