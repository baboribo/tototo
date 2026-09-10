import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

await mkdir('.verification', { recursive: true });
for (const name of ['motion', 'stems', 'drum-eq', 'reactive-ink', 'audio']) {
  const outfile = `.verification/verify-${name}.mjs`;
  await build({
    entryPoints: [`verify-${name}.${name === 'audio' ? 'mjs' : 'ts'}`],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
  });
  const result = spawnSync(process.execPath, [outfile], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
