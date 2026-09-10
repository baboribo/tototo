import type { Signal } from './signal';
import { recentHits, type DrumHit } from './drums';
import type { Channel } from './drum-eq';
export const drumColors = ['#cbdc8c', '#e9af8e', '#93cfd5', '#bdabe3', '#e3ce89'];
export function drawDrumGraphs(
  canvas: HTMLCanvasElement,
  thresholdCanvas: HTMLCanvasElement,
  channels: Channel[],
  selected: number,
  signal: Signal | undefined,
  hits: DrumHit[],
  levels: Float32Array[],
  time: number,
) {
  const colors = drumColors;
  const ctx = canvas.getContext('2d')!,
    w = canvas.width,
    h = canvas.height,
    plotBottom = h - 28,
    c = channels[selected],
    x = (f: number) => (Math.log(f / 20) / Math.log(1000)) * w;
  ctx.fillStyle = '#131b19';
  ctx.fillRect(0, 0, w, h);
  ctx.font = '12px monospace';
  for (const f of [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) {
    ctx.strokeStyle = '#30413b';
    ctx.beginPath();
    ctx.moveTo(x(f), 0);
    ctx.lineTo(x(f), plotBottom);
    ctx.stroke();
    ctx.fillStyle = '#9aaea5';
    ctx.fillText(f >= 1000 ? `${f / 1000}k` : String(f), Math.min(w - 40, x(f) + 4), h - 7);
  }
  ctx.fillStyle = colors[selected] + '22';
  ctx.fillRect(x(c.low), 0, x(c.high) - x(c.low), plotBottom);
  const s = signal?.spectrum,
    frame = Math.floor(time * (signal?.rate ?? 50));
  if (s && time >= 0 && time < signal!.duration) {
    ctx.strokeStyle = '#d7e7d1';
    ctx.beginPath();
    for (let b = 0; b < s.bins; b++) {
      const power = s.values[frame * s.bins + b] ?? 0,
        db = 10 * Math.log10(Math.max(1e-8, power));
      const px = x(20 * (s.maxHz / 20) ** ((b + 0.5) / s.bins)),
        y = plotBottom - Math.max(0, Math.min(1, (db + 70) / 70)) * (plotBottom - 24);
      b ? ctx.lineTo(px, y) : ctx.moveTo(px, y);
    }
    ctx.stroke();
  }
  ctx.strokeStyle = colors[selected];
  ctx.lineWidth = 2;
  for (const f of [c.low, c.high]) {
    ctx.beginPath();
    ctx.moveTo(x(f), 0);
    ctx.lineTo(x(f), plotBottom);
    ctx.stroke();
  }
  ctx.lineWidth = 1;
  ctx.fillStyle = colors[selected];
  ctx.fillText(
    `${c.kind.toUpperCase()}  ${c.low}–${c.high} Hz  /  ${c.gain > 0 ? '+' : ''}${c.gain} dB detection`,
    16,
    20,
  );
  const lc = thresholdCanvas.getContext('2d')!,
    lw = thresholdCanvas.width,
    lh = thresholdCanvas.height,
    level = levels[selected],
    rate = signal?.rate ?? 50;
  const y = (v: number) => lh * (1 - Math.max(0, Math.min(1.6, v)) / 1.6);
  lc.fillStyle = '#111a17';
  lc.fillRect(0, 0, lw, lh);
  lc.font = '12px monospace';
  for (const v of [0.4, 0.8, 1.2, 1.6]) {
    lc.strokeStyle = '#2d4137';
    lc.beginPath();
    lc.moveTo(0, y(v));
    lc.lineTo(lw, y(v));
    lc.stroke();
    lc.fillStyle = '#8ca294';
    lc.fillText(v.toFixed(1), 4, Math.max(12, y(v) - 3));
  }
  lc.strokeStyle = colors[selected];
  lc.beginPath();
  for (let px = 0; px < lw; px++) {
    const t = time - 3 + (px / (lw - 1)) * 3,
      v = t >= 0 ? (level?.[Math.floor(t * rate)] ?? 0) : 0;
    px ? lc.lineTo(px, y(v)) : lc.moveTo(px, y(v));
  }
  lc.stroke();
  for (const hit of recentHits(hits, time, 3, Infinity)) {
    if (hit.kind !== c.kind) continue;
    lc.fillStyle = '#f2f6cf';
    lc.beginPath();
    lc.arc(
      ((hit.time - time + 3) / 3) * lw,
      y(level?.[Math.floor(hit.time * rate)] ?? 0),
      3,
      0,
      Math.PI * 2,
    );
    lc.fill();
  }
  const current = time >= 0 && time < (signal?.duration ?? 0) ? (level?.[frame] ?? 0) : 0;
  lc.fillStyle = current >= c.threshold ? '#e7eeb5' : '#9eb5a8';
  lc.fillText(
    `현재 ${current.toFixed(2)} / ${current >= c.threshold ? '세기 조건 충족' : '기준 미만'}${c.enabled ? '' : ' / 채널 꺼짐'}`,
    Math.max(120, lw - 300),
    16,
  );
}
