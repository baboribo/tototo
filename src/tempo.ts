export type Tempo = { bpm: number; offset: number; confidence: number };

/** Global tempo and phase from a novelty curve, with no timing prior from the UI. */
export function detectTempo(values: Float32Array, rate: number, stride: number): Tempo | null {
  const count = values.length / stride;
  if (count < rate * 4) return null;
  const novelty = new Float32Array(count);
  let power = 0, peaks = 0;
  for (let i = 1; i < count; i++) {
    const v = Math.max(0, values[i * stride + 6] - values[(i - 1) * stride + 6] * 0.8)
      + Math.max(0, values[i * stride] - values[(i - 1) * stride]) * 0.5;
    novelty[i] = v;
    power += v * v;
    if (v > 0.1 && novelty[i - 1] < v) peaks++;
  }
  if (power < 0.03 || peaks < 5) return null;
  // Fractional lags avoid quantizing e.g. 127 BPM to a nearby integer FFT hop.
  const correlation = (lag: number) => {
    let sum = 0, aPower = 0, bPower = 0;
    for (let i = Math.ceil(lag); i < count; i++) {
      const p = i - lag, j = Math.floor(p), f = p - j;
      const a = novelty[i], b = novelty[j] * (1 - f) + novelty[j + 1] * f;
      sum += a * b; aPower += a * a; bPower += b * b;
    }
    return sum / Math.max(1e-9, Math.sqrt(aPower * bPower));
  };
  let bestBpm = 0, bestScore = 0, bestCorrelation = 0;
  for (let bpm = 65; bpm <= 190; bpm += 0.25) {
    const lag = 60 * rate / bpm, c = correlation(lag);
    const score = c * 0.65 + correlation(lag * 2) * 0.35;
    if (score > bestScore) { bestScore = score; bestBpm = bpm; bestCorrelation = c; }
  }
  if (bestCorrelation < 0.24) return null;
  const period = 60 / bestBpm;
  let offset = 0, phaseScore = -1;
  for (let phase = 0; phase < period; phase += 1 / (rate * 2)) {
    let score = 0, beats = 0;
    for (let time = phase; time < count / rate; time += period) {
      const index = Math.round(time * rate);
      // A one-hop aperture tolerates the analysis window and human timing.
      score += (novelty[index] ?? 0) + ((novelty[index - 1] ?? 0) + (novelty[index + 1] ?? 0)) * 0.35;
      beats++;
    }
    score /= Math.max(1, beats);
    if (score > phaseScore) { phaseScore = score; offset = phase; }
  }
  return { bpm: bestBpm, offset, confidence: Math.min(1, bestCorrelation) };
}

export function beatPulse(tempo: Tempo | null | undefined, time: number, window = 0.1) {
  if (!tempo || time < tempo.offset || tempo.confidence < 0.24) return { pulse: 0, index: -1 };
  const period = 60 / tempo.bpm;
  const index = Math.floor((time - tempo.offset + 1e-8) / period);
  const age = time - (tempo.offset + index * period);
  return { pulse: age >= -1e-8 && age < window ? 1 : 0, index };
}
