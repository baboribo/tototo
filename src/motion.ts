import { at, STRIDE, type Signal } from './signal';
import { beatPulse, type Tempo } from './tempo';
import { recentHits, type DrumHit, type DrumKind } from './drums';
import {
  perimeter,
  drumInk,
  type InkBar,
  type InkMark,
  type PerimeterSource,
} from './reactive-ink';

export type MotionOptions = {
  fps?: number;
  impact?: number;
  tileFade?: number;
  tempo?: Tempo | null;
  hits?: DrumHit[];
  otherSignal?: Signal;
  perimeterSource?: PerimeterSource;
  preloadedTiles?: PreloadedTiles;
};
type StripTile = Tile & { band?: number; kind?: DrumKind; weight: number };
type StripReaction = { bands: number[]; drums: Partial<Record<DrumKind, number>>; gate: number };
export type PreloadedTiles = {
  strip: StripTile[];
  frames: StripReaction[];
  fps: number;
  speed: number;
  origin: number;
  duration: number;
  tileCount: number;
};
// Browser range/media values may land fractions of a microsecond below a frame.
export const frameTime = (time: number, fps = 10) =>
  Math.floor((Math.max(0, time) + 1e-6) * fps) / fps;

export type Tile = {
  x: number;
  y: number;
  tone: number;
  opacity?: number;
  source?: 'drums' | 'other';
  cell?: string;
};
export type FramePlan = {
  tiles: Tile[];
  bars: InkBar[];
  trace: InkMark[];
  rings: number;
  pen: number;
  eraser: number;
  active: boolean;
};
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const valueAt = (signal: Signal | undefined, time: number, gain: number) => {
  const value = at(signal, time);
  return {
    ...value,
    bands: value.bands.map((v) => clamp(v * gain)),
    level: clamp(value.level * gain),
  };
};

// Stable event/cell hashes choose spatial placement only. Audio must supply ink.
const hash = (value: number) => {
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return (value ^ (value >>> 16)) >>> 0;
};

const smoothstep = (value: number) => {
  value = clamp(value);
  return value * value * (3 - 2 * value);
};

/** Rebuild a causal attack/release envelope from analysis history. */
function smoothedBand(
  signal: Signal | undefined,
  time: number,
  band: number,
  gain: number,
  duration: number,
) {
  if (!signal || time < 0) return 0;
  const step = 1 / signal.rate;
  const attack = Math.max(step, duration);
  const release = Math.max(step, duration * 1.6);
  const start = Math.max(0, time - Math.max(0.5, release * 4));
  let envelope = 0;
  for (let sampleTime = start; sampleTime <= time + step / 2; sampleTime += step) {
    const frame = Math.min(Math.floor(sampleTime * signal.rate), signal.values.length / STRIDE - 1);
    const target =
      sampleTime >= signal.duration ? 0 : clamp((signal.values[frame * STRIDE + band] ?? 0) * gain);
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

function historyTiles(
  other: Signal | undefined,
  hits: DrumHit[],
  time: number,
  gain: number,
  impact: number,
  fade: number,
  period: number,
  origin: number,
) {
  const cells = new Map<string, Tile>();
  const speed = 15 / period;
  const transport = Math.round((time - origin) * speed);
  const otherGate = kickGate(hits, time, gain, impact, fade);
  const live = Array.from({ length: 5 }, (_, band) => smoothedBand(other, time, band, gain, fade));
  // World columns never wrap. Each new column samples a different moment in
  // the rest stem; its band assignment and printed strength then travel intact.
  for (
    let column = Math.floor(transport / 15);
    column <= Math.floor(transport / 15) + 4;
    column++
  ) {
    const x = 130 + column * 15 - transport;
    const birth = origin + (column - 3) * period;
    if (x + 15 <= 130 || x >= 190 || birth < 0 || birth > time) continue;
    const feature = valueAt(other, birth, gain);
    if (feature.level <= 0.045) continue;
    const signature = feature.bands.reduce(
      (seed, v, band) => seed ^ Math.imul(Math.round(v * 255), 31 ** band),
      0,
    );
    for (let row = 0; row < 4; row++) {
      const seed = hash((column * 17 + row * 101) ^ signature);
      const band = seed % 5;
      const threshold = 0.2 + ((seed >>> 8) % 35) / 100;
      const amount = smoothstep((feature.bands[band] - threshold) / (1 - threshold));
      const entrance = smoothstep((time - birth + 0.02) / fade);
      const opacity = amount * entrance * (0.65 + live[band] * 0.35) * otherGate;
      if (opacity <= 0.025) continue;
      const cell = `${column},${row}`;
      cells.set(cell, {
        cell,
        x,
        y: 90 + row * 15,
        tone: amount > 0.72 ? 3 : amount > 0.34 ? 2 : 1,
        opacity: Number(opacity.toFixed(3)),
        source: 'other',
      });
    }
  }
  // A hit prints into the shared moving grid inside the crop. Later strikes
  // overwrite that world cell; old marks leave on the left without reappearing.
  for (const event of recentHits(hits, time, 5 * period, Infinity).reverse()) {
    const seed = hash(event.seed);
    const row = (seed >>> 8) % 4;
    const column = Math.floor((event.time - origin) / period + 1e-8) + (seed % 4);
    const x = 130 + column * 15 - transport;
    if (x + 15 <= 130 || x >= 190) continue;
    const age = time - event.time;
    const envelope = 0.12 + 0.88 * smoothstep(1 - Math.max(0, age - 0.08) / fade);
    const amount = clamp(event.strength * gain * (0.5 + impact)) * envelope;
    if (amount <= 0.025) continue;
    const cell = `${column},${row}`;
    cells.set(cell, {
      cell,
      x,
      y: 90 + row * 15,
      tone: amount > 0.68 ? 3 : amount > 0.3 ? 2 : 1,
      opacity: Number(amount.toFixed(3)),
      source: 'drums',
    });
  }
  return [...cells.values()];
}

/** Build the full strip and its shared musical clock. Visibility never gates
 * a tile's reaction: all tiles, including future/offscreen cells, share it. */
export function preloadTiles(
  signal: Signal,
  gain: number,
  options: MotionOptions,
  progress?: (percent: number) => void,
): PreloadedTiles {
  const fps = options.fps ?? 10;
  const tempo = options.tempo === undefined ? signal.tempo : options.tempo;
  const period = tempo && tempo.confidence >= 0.24 ? 60 / tempo.bpm : 0.42;
  const origin = tempo?.offset ?? 0,
    speed = 15 / period;
  const duration = Math.max(signal.duration, options.otherSignal?.duration ?? 0);
  const other = options.otherSignal ?? signal,
    hits = options.hits ?? [];
  const fade = Math.max(0.05, options.tileFade ?? 0.3),
    impact = options.impact ?? 1;
  const cells = new Map<string, StripTile>();
  for (
    let column = Math.ceil(-origin / period) + 3;
    origin + (column - 3) * period < duration;
    column++
  ) {
    const feature = valueAt(other, origin + (column - 3) * period, gain);
    if (feature.level <= 0.045) continue;
    const signature = feature.bands.reduce(
      (seed, v, band) => seed ^ Math.imul(Math.round(v * 255), 31 ** band),
      0,
    );
    for (let row = 0; row < 4; row++) {
      const seed = hash((column * 17 + row * 101) ^ signature),
        band = seed % 5;
      const threshold = 0.2 + ((seed >>> 8) % 35) / 100;
      const weight = smoothstep((feature.bands[band] - threshold) / (1 - threshold));
      if (weight <= 0.025) continue;
      const cell = `${column},${row}`;
      cells.set(cell, {
        cell,
        x: 130 + column * 15,
        y: 90 + row * 15,
        tone: weight > 0.72 ? 3 : weight > 0.34 ? 2 : 1,
        source: 'other',
        band,
        weight,
      });
    }
  }
  for (const event of hits) {
    const seed = hash(event.seed),
      row = (seed >>> 8) % 4;
    const column = Math.floor((event.time - origin) / period + 1e-8) + (seed % 4),
      cell = `${column},${row}`;
    cells.set(cell, {
      cell,
      x: 130 + column * 15,
      y: 90 + row * 15,
      tone: 3,
      source: 'drums',
      kind: event.kind,
      weight: clamp(event.strength * gain * (0.5 + impact)),
    });
  }
  const strip = [...cells.values()],
    frames: StripReaction[] = [];
  const count = Math.ceil(duration * fps) + 1;
  for (let index = 0; index < count; index++) {
    const time = index / fps;
    const drums: StripReaction['drums'] = {};
    for (const hit of recentHits(hits, time, fade + 0.08, Infinity)) {
      const envelope = smoothstep(1 - Math.max(0, time - hit.time - 0.08) / fade);
      drums[hit.kind] = Math.max(
        drums[hit.kind] ?? 0,
        clamp(hit.strength * gain * (0.5 + impact)) * envelope,
      );
    }
    frames.push({
      bands: Array.from({ length: 5 }, (_, band) => smoothedBand(other, time, band, gain, fade)),
      drums,
      gate: kickGate(hits, time, gain, impact, fade),
    });
    if (index % 100 === 0) progress?.(Math.floor((index / count) * 100));
  }
  progress?.(100);
  return { strip, frames, fps, speed, origin, duration, tileCount: strip.length };
}

function reactPreloadedStrip(track: PreloadedTiles, time: number): Tile[] {
  const reaction = track.frames[Math.floor((time + 1e-6) * track.fps)];
  const transport = Math.round((time - track.origin) * track.speed);
  return track.strip.map((tile) => {
    const drive =
      tile.source === 'other'
        ? (reaction?.bands[tile.band!] ?? 0) * (reaction?.gate ?? 0)
        : (reaction?.drums[tile.kind!] ?? 0);
    const amount = tile.weight * drive;
    return {
      ...tile,
      x: tile.x - transport,
      opacity: Number(amount.toFixed(3)),
      tone: tile.source === 'drums' ? (amount > 0.68 ? 3 : amount > 0.3 ? 2 : 1) : tile.tone,
    };
  });
}

/** Pure time→geometry mapping: seeking and display refresh rate cannot alter it. */
export function planFrame(
  signal: Signal | undefined,
  time: number,
  gain = 1,
  options: MotionOptions = {},
): FramePlan {
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
  const otherNow = valueAt(other, time, gain);
  const beat = beatPulse(
    options.tempo === undefined ? signal?.tempo : options.tempo,
    time,
    Math.max(1 / fps, 0.09),
  );
  const impact = options.impact ?? 1;
  const tileFade = Math.max(0.05, options.tileFade ?? 0.3);
  const hit = active ? clamp(Math.max(now.onset * 1.8, beat.pulse * 0.85) * impact) : 0;
  const plan: FramePlan = { tiles: [], bars: [], trace: [], rings: 0, pen: 0, eraser: 0, active };
  // Past samples carry the printed pattern; present beat/onsets overprint selected
  // cells for one held frame. Geometry stays fixed while ink tone flashes.
  const tempo = options.tempo === undefined ? signal?.tempo : options.tempo;
  const period = tempo && tempo.confidence >= 0.24 ? 60 / tempo.bpm : 0.42,
    speed = 15 / period;
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
        tone =
          value > 0.5 && (value > strongest * 0.82 || feature.onset > 0.2)
            ? 3
            : value > 0.34
              ? 2
              : 1;
      }
      const lane = now.bands[3 - row];
      if (
        tone > 0 &&
        hit > 0.48 &&
        lane > 0.15 &&
        (column + row + Math.max(0, beat.index)) % 2 === 0
      ) {
        tone = tone === 3 ? 1 : 3;
      }
      if (tone)
        plan.tiles.push({ x: Math.round(190 - (time - birth) * speed), y: 90 + row * 15, tone });
    }
  }
  if (options.hits) {
    const track = options.preloadedTiles;
    plan.tiles = track
      ? reactPreloadedStrip(track, time)
      : historyTiles(other, options.hits, time, gain, impact, tileFade, period, origin);
    plan.active =
      plan.tiles.some((tile) => tile.x + 15 > 130 && tile.x < 190 && (tile.opacity ?? 1) > 0.025) ||
      otherNow.level > 0.045;
  }
  const border = perimeter(
    signal,
    other,
    time,
    gain,
    Math.max(1 / fps, 0.08),
    options.perimeterSource,
    impact,
  );
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
    const strength = clamp(
      Math.max(0, feature.onset - 0.08) * 1.8 + Math.max(0, feature.bands[3] - 0.4) * 0.3,
    );
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
    this.surface.width = 320;
    this.surface.height = 240;
    this.ctx = this.surface.getContext('2d', { alpha: false })!;
    this.output = canvas.getContext('2d', { alpha: false })!;
  }
  private rect(x: number, y: number, width: number, height: number, color = this.ink) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(Math.round(x), Math.round(y), width, height);
  }
  private texture(x: number, y: number, width: number, height: number, tone: number) {
    if (tone === 3) {
      this.rect(x, y, width, height);
      return;
    }
    for (let yy = 0; yy < height; yy++)
      for (let xx = 0; xx < width; xx++) {
        // Texture is anchored to the printed cell, and travels with it.
        const dark =
          tone === 2
            ? (xx + yy) % 3 !== 0 && (xx - yy + 300) % 3 !== 0
            : xx % 3 === 1 && yy % 3 === 1;
        if (dark) this.rect(x + xx, y + yy, 1, 1);
      }
  }
  private dottedBox(x: number, y: number, size: number) {
    for (let n = 0; n <= size; n += 3) {
      this.rect(x + n, y, 1, 1);
      this.rect(x + n, y + size, 1, 1);
      this.rect(x, y + n, 1, 1);
      this.rect(x + size, y + n, 1, 1);
    }
  }
  render(
    signal: Signal | undefined,
    time: number,
    gain = 1,
    caption = '',
    options: MotionOptions = {},
  ) {
    time = frameTime(time, options.fps ?? 10);
    const plan = planFrame(signal, time, gain, options),
      ctx = this.ctx;
    this.rect(0, 0, 320, 240, this.paper);
    if (plan.active || !signal || time === 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(130, 90, 60, 60);
      ctx.clip();
      for (const tile of plan.tiles) {
        // Reactions above include the whole strip. Only raster drawing is culled.
        if (tile.x + 15 <= 130 || tile.x >= 190 || (tile.opacity ?? 1) <= 0) continue;
        ctx.save();
        ctx.globalAlpha = tile.opacity ?? 1;
        this.texture(tile.x, tile.y, 15, 15, tile.tone);
        ctx.restore();
      }
      ctx.restore();
      this.dottedBox(130, 90, 60);
      for (let ring = 0; ring < plan.rings; ring++)
        this.dottedBox(127 - ring * 3, 87 - ring * 3, 66 + ring * 6);
      if (plan.rings === 3) {
        this.dottedBox(125, 85, 70);
        this.dottedBox(123, 83, 74);
      }
      for (const bar of plan.bars)
        for (let yy = 0; yy < bar.height; yy++)
          for (let xx = 0; xx < bar.width; xx++) {
            const x = bar.x + xx,
              y = bar.y + yy;
            const across = bar.width === 3 ? xx : yy;
            if (
              bar.tone === 3 ||
              (bar.tone === 2
                ? (bar.phase + across) % 3 !== 0
                : bar.phase % 3 === 0 && across === 1)
            )
              this.rect(x, y, 1, 1);
          }
    }
    for (const mark of plan.trace)
      for (let y = -mark.height; y <= mark.height; y++) {
        const phase = mark.phase ?? mark.x + Math.floor(time * 160);
        if (mark.tone === 3 || (phase + y + 1000) % 3 !== 0) this.rect(mark.x, 176 + y, 1, 1);
      }
    // Eraser: stippled rubber block with an outlined unfilled cap.
    const ey = 184 - plan.eraser;
    this.rect(55, ey, 15, 18);
    this.texture(56, ey + 1, 13, 16, 2);
    for (let y = ey + 1; y < ey + 17; y += 3)
      for (let x = 56; x < 69; x += 3) this.rect(x, y, 1, 1, '#59604f');
    this.rect(56, ey - 5, 1, 5);
    this.rect(68, ey - 3, 1, 3);
    for (let x = 57; x < 68; x += 3) this.rect(x, ey - 5, 2, 1);
    // Upward pointed nib, split down the centre; short stippled holder below.
    const py = 180 - plan.pen;
    this.rect(262, py, 1, 11);
    for (let i = 0; i < 7; i++) {
      this.rect(262 - i, py + 2 + i * 2, 1, 1);
      this.rect(262 + i, py + 2 + i * 2, 1, 1);
    }
    this.rect(256, py + 15, 3, 1);
    this.rect(266, py + 15, 3, 1);
    this.rect(257, py + 17, 11, 6);
    for (let x = 258; x < 268; x += 3) this.rect(x, py + 18, 1, 1, this.paper);
    if (caption.trim() && plan.active) {
      ctx.fillStyle = '#8f9787';
      ctx.font = '10px serif';
      ctx.textAlign = 'center';
      [...caption.trim().slice(0, 20)].forEach((char, i) => ctx.fillText(char, 282, 62 + i * 9));
    }
    this.output.imageSmoothingEnabled = false;
    this.output.drawImage(this.surface, 0, 0, this.canvas.width, this.canvas.height);
    return plan;
  }
}
