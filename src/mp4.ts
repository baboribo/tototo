type Bytes = Uint8Array;

const encoder = new TextEncoder();
const text = (value: string) => encoder.encode(value);
const join = (...parts: Bytes[]) => {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};
function uint16(value: number) {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value);
  return out;
}
function uint32(value: number) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value);
  return out;
}
function fixed16(value: number) {
  return uint32(Math.round(value * 65536));
}
function box(type: string, ...payload: Bytes[]) {
  const body = join(...payload);
  return join(uint32(body.length + 8), text(type), body);
}
function fullBox(type: string, version: number, flags: number, ...payload: Bytes[]) {
  return box(
    type,
    new Uint8Array([version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255]),
    ...payload,
  );
}
function identityMatrix() {
  return join(
    uint32(0x00010000),
    uint32(0),
    uint32(0),
    uint32(0),
    uint32(0x00010000),
    uint32(0),
    uint32(0),
    uint32(0),
    uint32(0x40000000),
  );
}
function descriptor(tag: number, payload: Bytes) {
  const length: number[] = [];
  let value = payload.length;
  length.unshift(value & 0x7f);
  value >>= 7;
  while (value) {
    length.unshift((value & 0x7f) | 0x80);
    value >>= 7;
  }
  return join(new Uint8Array([tag]), new Uint8Array(length), payload);
}
function groupDurations(values: number[]) {
  const out: Bytes[] = [];
  for (let index = 0; index < values.length;) {
    const delta = values[index];
    let count = 1;
    index++;
    while (index < values.length && values[index] === delta) {
      count++;
      index++;
    }
    out.push(uint32(count), uint32(delta));
  }
  return join(uint32(out.length / 2), ...out);
}
function stsc(sampleCount: number) {
  return join(uint32(1), uint32(1), uint32(sampleCount > 0 ? 1 : 0), uint32(1));
}
function stsz(sizes: number[]) {
  return join(uint32(0), uint32(sizes.length), ...sizes.map(uint32));
}
function stco(offsets: number[]) {
  return join(uint32(offsets.length), ...offsets.map(uint32));
}

export type EncodedSample = { data: Bytes; duration: number; key?: boolean };
export type Mp4Track = {
  kind: 'video' | 'audio';
  samples: EncodedSample[];
  timescale: number;
  description: Bytes;
  width?: number;
  height?: number;
  channels?: number;
  sampleRate?: number;
};

function videoSampleDescription(track: Mp4Track) {
  const compressor = new Uint8Array(32);
  return box(
    'avc1',
    new Uint8Array(6),
    uint16(1),
    new Uint8Array(16),
    uint16(track.width!),
    uint16(track.height!),
    fixed16(72),
    fixed16(72),
    uint32(0),
    uint16(1),
    compressor,
    uint16(0x18),
    uint16(0xffff),
    box('avcC', track.description),
  );
}
function audioSpecificConfig(rate: number, channels: number) {
  const rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000];
  const index = Math.max(0, rates.indexOf(rate));
  return new Uint8Array([(2 << 3) | (index >> 1), ((index & 1) << 7) | (channels << 3)]);
}
function audioSampleDescription(track: Mp4Track) {
  const config = track.description.length
    ? track.description
    : audioSpecificConfig(track.sampleRate!, track.channels!);
  const decoderConfig = join(
    new Uint8Array([0x40, 0x15]),
    new Uint8Array(3),
    uint32(0),
    uint32(0),
    descriptor(5, config),
    descriptor(6, new Uint8Array([2])),
  );
  const es = descriptor(3, join(uint16(2), new Uint8Array([0]), descriptor(4, decoderConfig)));
  const esds = fullBox('esds', 0, 0, es);
  return box(
    'mp4a',
    new Uint8Array(6),
    uint16(1),
    new Uint8Array(8),
    uint16(track.channels!),
    uint16(16),
    uint16(0),
    uint16(0),
    fixed16(track.sampleRate!),
    esds,
  );
}
function sampleTable(track: Mp4Track, offsets: number[]) {
  const sizes = track.samples.map((sample) => sample.data.length);
  const durations = track.samples.map((sample) => sample.duration);
  const description =
    track.kind === 'video' ? videoSampleDescription(track) : audioSampleDescription(track);
  const sampleEntries = [fullBox('stsd', 0, 0, uint32(1), description)];
  const tables = [
    fullBox('stts', 0, 0, groupDurations(durations)),
    fullBox('stsc', 0, 0, stsc(track.samples.length)),
    fullBox('stsz', 0, 0, stsz(sizes)),
    fullBox('stco', 0, 0, stco(offsets)),
  ];
  if (track.kind === 'video') {
    const sync = track.samples.map((sample, index) => (sample.key ? index + 1 : 0)).filter(Boolean);
    tables.push(fullBox('stss', 0, 0, uint32(sync.length), ...sync.map(uint32)));
  }
  return box('stbl', ...sampleEntries, ...tables);
}
function trackBox(track: Mp4Track, id: number, offsets: number[], movieTimescale: number) {
  const duration = track.samples.reduce((sum, sample) => sum + sample.duration, 0);
  const movieDuration = Math.round((duration / track.timescale) * movieTimescale);
  const isVideo = track.kind === 'video';
  const tkhd = fullBox(
    'tkhd',
    0,
    7,
    uint32(0),
    uint32(0),
    uint32(id),
    uint32(0),
    uint32(movieDuration),
    new Uint8Array(8),
    uint16(0),
    uint16(0),
    uint16(isVideo ? 0 : 0x0100),
    uint16(0),
    identityMatrix(),
    fixed16(isVideo ? track.width! : 0),
    fixed16(isVideo ? track.height! : 0),
  );
  const mdhd = fullBox(
    'mdhd',
    0,
    0,
    uint32(0),
    uint32(0),
    uint32(track.timescale),
    uint32(duration),
    uint16(0x55c4),
    uint16(0),
  );
  const hdlr = fullBox(
    'hdlr',
    0,
    0,
    uint32(0),
    text(isVideo ? 'vide' : 'soun'),
    new Uint8Array(12),
    text(isVideo ? 'tototo video\0' : 'tototo audio\0'),
  );
  const mediaHeader = isVideo
    ? fullBox('vmhd', 0, 1, uint16(0), uint16(0), uint16(0), uint16(0))
    : fullBox('smhd', 0, 0, uint16(0), uint16(0));
  const url = fullBox('url ', 0, 1);
  const dinf = box('dinf', fullBox('dref', 0, 0, uint32(1), url));
  const minf = box('minf', mediaHeader, dinf, sampleTable(track, offsets));
  return box('trak', tkhd, box('mdia', mdhd, hdlr, minf));
}

export function muxMp4(video: Mp4Track, audio: Mp4Track): Blob {
  const movieTimescale = 1000;
  const ftyp = box('ftyp', text('isom'), uint32(0x200), text('isomiso2mp41mp42'));
  const media = [...video.samples, ...audio.samples];
  const mediaData = join(...media.map((sample) => sample.data));
  let moov = new Uint8Array();
  let videoOffsets: number[] = [],
    audioOffsets: number[] = [];
  for (let iteration = 0; iteration < 3; iteration++) {
    const base = ftyp.length + moov.length + 8;
    let offset = base;
    videoOffsets = video.samples.map((sample) => {
      const current = offset;
      offset += sample.data.length;
      return current;
    });
    audioOffsets = audio.samples.map((sample) => {
      const current = offset;
      offset += sample.data.length;
      return current;
    });
    const videoDuration = video.samples.reduce((sum, sample) => sum + sample.duration, 0);
    const audioDuration = audio.samples.reduce((sum, sample) => sum + sample.duration, 0);
    const duration = Math.round(
      Math.max(videoDuration / video.timescale, audioDuration / audio.timescale) * movieTimescale,
    );
    const mvhd = fullBox(
      'mvhd',
      0,
      0,
      uint32(0),
      uint32(0),
      uint32(movieTimescale),
      uint32(duration),
      fixed16(1),
      uint16(0x0100),
      new Uint8Array(10),
      identityMatrix(),
      new Uint8Array(24),
      uint32(3),
    );
    moov = box(
      'moov',
      mvhd,
      trackBox(video, 1, videoOffsets, movieTimescale),
      trackBox(audio, 2, audioOffsets, movieTimescale),
    );
  }
  return new Blob([ftyp, moov, box('mdat', mediaData)], { type: 'video/mp4' });
}
