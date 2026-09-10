function fft(real: Float64Array, imag: Float64Array, inverse = false) {
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
    const a = ((inverse ? 2 : -2) * Math.PI) / length,
      wr = Math.cos(a),
      wi = Math.sin(a);
    for (let start = 0; start < n; start += length) {
      let ur = 1,
        ui = 0;
      for (let j = 0; j < length / 2; j++) {
        const x = start + j,
          y = x + length / 2,
          tr = real[y] * ur - imag[y] * ui,
          ti = real[y] * ui + imag[y] * ur;
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
  if (inverse)
    for (let i = 0; i < n; i++) {
      real[i] /= n;
      imag[i] /= n;
    }
}

/** Local HPSS-style percussion approximation, NOT a learned drum-source model.
 * Complementary time-frequency masks reconstruct two actual audio signals. */
export function separate(samples: Float32Array) {
  const n = 1024,
    hop = 256,
    bins = n / 2 + 1,
    frames = Math.ceil(samples.length / hop) + 1;
  const magnitudes = new Float32Array(frames * bins),
    real = new Float64Array(n),
    imag = new Float64Array(n);
  const window = Float64Array.from(
    { length: n },
    (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)),
  );
  const read = (frame: number) => {
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
  const drums = new Float32Array(samples.length),
    rest = new Float32Array(samples.length),
    norm = new Float32Array(samples.length),
    scratch = new Float32Array(9);
  for (let f = 0; f < frames; f++) {
    read(f);
    for (let k = 0; k < bins; k++) {
      for (let d = -4; d <= 4; d++)
        scratch[d + 4] = magnitudes[Math.max(0, Math.min(frames - 1, f + d)) * bins + k];
      scratch.sort();
      const harmonic = scratch[4];
      for (let d = -4; d <= 4; d++)
        scratch[d + 4] = magnitudes[f * bins + Math.max(0, Math.min(bins - 1, k + d))];
      scratch.sort();
      const percussive = Math.max(
        scratch[4],
        Math.max(0, magnitudes[f * bins + k] - harmonic * 1.5) * 0.7,
      );
      const mask =
        (percussive * percussive) / (percussive * percussive + harmonic * harmonic + 1e-16);
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

export function wav(channels: Float32Array[], rate: number): Blob {
  const count = Math.max(...channels.map((c) => c.length)),
    n = channels.length;
  const buffer = new ArrayBuffer(44 + count * n * 2),
    view = new DataView(buffer);
  const text = (at: number, s: string) =>
    [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + count * n * 2, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, n, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * n * 2, true);
  view.setUint16(32, n * 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, count * n * 2, true);
  for (let i = 0; i < count; i++)
    for (let c = 0; c < n; c++)
      view.setInt16(
        44 + (i * n + c) * 2,
        Math.round(Math.max(-1, Math.min(1, channels[c][i] ?? 0)) * 32767),
        true,
      );
  return new Blob([buffer], { type: 'audio/wav' });
}
