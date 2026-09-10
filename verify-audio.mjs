import { identifyAudio, testSound } from './src/audio-file.ts';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const sound = testSound();
assert.equal(sound.type, '');
assert.equal(await identifyAudio(sound), 'audio/wav');
assert.equal(
  await identifyAudio(
    new File([await sound.arrayBuffer()], 'wrong.bin', { type: 'application/octet-stream' }),
  ),
  'audio/wav',
);
assert.equal(
  await identifyAudio(new File(['not music'], 'fake.mp3', { type: 'audio/mpeg' })),
  undefined,
);
assert.equal(await identifyAudio(new Blob(['fLaC'])), 'audio/flac');
assert.equal(await identifyAudio(new Blob(['OggS'])), 'audio/ogg');
assert.equal(await identifyAudio(new Blob(['ID3'])), 'audio/mpeg');
assert.equal(await identifyAudio(new Blob([new Uint8Array([255, 241, 80, 0])])), 'audio/aac');
await mkdir('test-fixtures', { recursive: true });
await writeFile('test-fixtures/mislabelled.bin', new Uint8Array(await sound.arrayBuffer()));
await writeFile('test-fixtures/invalid.mp3', 'not audio');
console.log(
  'PASS: missing MIME, incorrect MIME/extension, invalid audio, FLAC/OGG/MP3/AAC signatures. Browser fixtures ready.',
);
