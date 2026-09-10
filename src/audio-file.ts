/** Inspect bytes rather than trusting OS MIME metadata or filename extensions. */
export async function identifyAudio(file: Blob): Promise<string | undefined> {
  const bytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const text = new TextDecoder('latin1').decode(bytes);
  if (text.startsWith('RIFF') && text.slice(8, 12) === 'WAVE') return 'audio/wav';
  if (text.startsWith('fLaC')) return 'audio/flac';
  if (text.startsWith('OggS')) return 'audio/ogg';
  if (
    text.startsWith('ID3') ||
    (bytes[0] === 255 && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x06) !== 0)
  )
    return 'audio/mpeg';
  if (bytes[0] === 255 && (bytes[1] & 0xf6) === 0xf0) return 'audio/aac';
  if (text.slice(4, 8) === 'ftyp') return 'audio/mp4';
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3)
    return 'audio/webm';
  return undefined;
}

/** Original, locally synthesized diagnostic file: bass, mid, treble, silence. */
export function testSound(rhythm = false): File {
  const rate = 44100,
    seconds = rhythm ? 24 : 16,
    count = rate * seconds;
  const buffer = new ArrayBuffer(44 + count * 2),
    view = new DataView(buffer);
  const ascii = (offset: number, text: string) =>
    [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + count * 2, true);
  ascii(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i++) {
    const time = i / rate,
      phase = time % 4,
      frequency = [90, 800, 5000, 0][Math.floor(time / 4)];
    const envelope =
      Math.min(1, phase * 30, (4 - phase) * 30) * (0.55 + 0.45 * Math.cos(time * Math.PI * 4));
    let sample = Math.sin(2 * Math.PI * frequency * time) * envelope * 0.22;
    if (rhythm) {
      const beat = time % 0.4,
        eighth = time % 0.2,
        step = Math.floor(time / 0.2);
      const note = [60, 64, 67, 71, 69, 67, 64, 62, 57, 60, 64, 67, 65, 64, 60, 59][step % 16];
      const f = 440 * 2 ** ((note - 69) / 12);
      const melody =
        (Math.sin(time * f * Math.PI * 2) + Math.sin(time * f * Math.PI * 4) * 0.25) *
        Math.exp(-eighth * 18);
      const bass =
        Math.sin(time * [65.406, 55, 43.654, 48.999][Math.floor(time / 3.2) % 4] * Math.PI * 2) *
        Math.exp(-beat * 9);
      const kick =
        Math.sin(2 * Math.PI * (45 * beat + 10 * (1 - Math.exp(-beat * 30)))) *
        Math.exp(-beat * 30);
      const hiss = ((Math.sin(i * 12.9898) * 43758.5453) % 1) * Math.exp(-eighth * 110);
      sample =
        (melody * 0.12 + bass * 0.15 + kick * 0.12 + hiss * 0.055) *
        Math.min(1, time * 20, Math.max(0, 22.4 - time) * 3);
    }
    view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true);
  }
  // Intentionally missing MIME: exercises the same recognition path as OS-mislabelled files.
  return new File([buffer], rhythm ? '잉크 리듬 — 오리지널 샘플.wav' : '진단 사운드.wav', {
    type: '',
  });
}
