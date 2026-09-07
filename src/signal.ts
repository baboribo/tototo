import { detectTempo, type Tempo } from './tempo';
export const RATE = 50;
export const STRIDE = 7;
export type Spectrum = { values: Float32Array; bins:number; maxHz:number };
export type Signal = { values: Float32Array; duration: number; rate: number; tempo: Tempo | null; spectrum?:Spectrum };
export type Feature = { bands: number[]; level: number; onset: number };
export const silent = (): Feature => ({ bands: [0, 0, 0, 0, 0], level: 0, onset: 0 });

/** Windowed FFT. All visual history is derived from these audio samples. */
export function analyse(samples: Float32Array, sampleRate: number, spectral=false): Signal {
  const n = 2048, count = Math.ceil(samples.length / sampleRate * RATE);
  const values = new Float32Array(count * STRIDE);
  const bins=128,maxHz=Math.min(20000,sampleRate/2);
  const spectrum=spectral?{values:new Float32Array(count*bins),bins,maxHz}:undefined;
  const real = new Float64Array(n), imaginary = new Float64Array(n);
  const window = Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)));
  const edges = [40, 180, 500, 2000, 8000, Math.min(16000, sampleRate / 2)];
  for (let frame = 0; frame < count; frame++) {
    const start = Math.round(frame / RATE * sampleRate) - n / 2;
    let energy = 0;
    for (let i = 0; i < n; i++) { const sample = samples[start + i] ?? 0; real[i] = sample * window[i]; imaginary[i] = 0; energy += sample * sample; }
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) [real[i], real[j]] = [real[j], real[i]];
    }
    for (let length = 2; length <= n; length <<= 1) {
      const angle = -2 * Math.PI / length, wr = Math.cos(angle), wi = Math.sin(angle);
      for (let start = 0; start < n; start += length) {
        let ur = 1, ui = 0;
        for (let j = 0; j < length / 2; j++) {
          const a = start + j, b = a + length / 2;
          const tr = real[b] * ur - imaginary[b] * ui, ti = real[b] * ui + imaginary[b] * ur;
          real[b] = real[a] - tr; imaginary[b] = imaginary[a] - ti;
          real[a] += tr; imaginary[a] += ti;
          const next = ur * wr - ui * wi; ui = ur * wi + ui * wr; ur = next;
        }
      }
    }
    if(spectrum)for(let i=1;i<n/2;i++){
      const hz=i*sampleRate/n;
      if(hz<20||hz>=maxHz)continue;
      const bin=Math.min(bins-1,Math.floor(Math.log(hz/20)/Math.log(maxHz/20)*bins));
      spectrum.values[frame*bins+bin]+=(real[i]**2+imaginary[i]**2)/(n*n);
    }
    for (let band = 0; band < 5; band++) {
      let power = 0;
      for (let i = Math.max(1, Math.ceil(edges[band] * n / sampleRate)); i < Math.min(n / 2, Math.ceil(edges[band + 1] * n / sampleRate)); i++) power += real[i] ** 2 + imaginary[i] ** 2;
      values[frame * STRIDE + band] = Math.sqrt(power) / n;
    }
    values[frame * STRIDE + 5] = Math.sqrt(energy / n);
  }
  // One shared reference retains relative spectral strength; a per-band normalizer
  // would amplify an absent instrument's numerical noise into a visible channel.
  const levels = Array.from({ length: count }, (_, i) => values[i * STRIDE + 5]).sort((a, b) => a - b);
  const reference = Math.max(0.015, levels[Math.floor(count * 0.95)] ?? 0);
  if(spectrum)for(let i=0;i<spectrum.values.length;i++)spectrum.values[i]/=(reference*0.58)**2;
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
  return { values, duration: samples.length / sampleRate, rate: RATE, tempo: detectTempo(values, RATE, STRIDE),spectrum };
}

export function at(signal: Signal | undefined, seconds: number): Feature {
  if (!signal || seconds < 0 || seconds >= signal.duration) return silent();
  const index = Math.min(Math.floor(seconds * signal.rate), signal.values.length / STRIDE - 1) * STRIDE;
  return { bands: Array.from(signal.values.subarray(index, index + 5)), level: signal.values[index + 5], onset: signal.values[index + 6] };
}
