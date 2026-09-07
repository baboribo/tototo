import { test, expect } from '@playwright/test';

function wavTone(frequency: number, seconds = 2, sampleRate = 22050) {
  const frames = seconds * sampleRate;
  const buffer = Buffer.alloc(44 + frames * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + frames * 2, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(frames * 2, 40);
  for (let index = 0; index < frames; index++) {
    const envelope = index % Math.floor(sampleRate / 2) < 900 ? Math.exp(-(index % Math.floor(sampleRate / 2)) / 230) : .08;
    const sample = Math.sin(2 * Math.PI * frequency * index / sampleRate) * envelope;
    buffer.writeInt16LE(Math.round(sample * 24000), 44 + index * 2);
  }
  return buffer;
}

test('layout keeps preview and transport on screen at desktop and narrow widths', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#drum-spectrum')).toBeAttached();
  for (const size of [{width:1440,height:900}, {width:1280,height:720}, {width:900,height:600}, {width:390,height:844}]) {
    await page.setViewportSize(size);
    await page.getByRole('tab', {name:'오디오', exact:true}).click();
    const layout = await page.evaluate(() => {
      const canvas = document.querySelector('#visualizer')!.getBoundingClientRect();
      const player = document.querySelector('.transport')!.getBoundingClientRect();
      return { overflow: document.documentElement.scrollWidth > innerWidth, canvasBottom: canvas.bottom, playerTop: player.top, playerBottom: player.bottom, ratio: canvas.width / canvas.height };
    });
    expect(layout.overflow).toBe(false);
    expect(layout.ratio).toBeCloseTo(4 / 3, 2);
    expect(layout.canvasBottom).toBeLessThanOrEqual(layout.playerTop);
    if (size.width > 720) expect(layout.playerBottom).toBeLessThanOrEqual(size.height);
    await page.screenshot({path: `.verification/workspace-${size.width}.png`, fullPage:true});
    await page.getByRole('tab', {name:'화면', exact:true}).click();
    await expect(page.getByRole('slider', {name:'반응 감도'})).toBeVisible();
    await page.screenshot({path: `.verification/visual-${size.width}.png`, fullPage:true});
    await page.getByRole('tab', {name:'드럼', exact:true}).click();
    await expect(page.locator('#drum-spectrum')).toBeVisible();
    const graphs = await page.evaluate(() => {
      const dimensions = (id: string) => {
        const canvas = document.querySelector<HTMLCanvasElement>(id)!;
        const rect = canvas.getBoundingClientRect();
        return { width: rect.width, height: rect.height, intrinsicRatio: canvas.width / canvas.height, displayRatio: rect.width / rect.height };
      };
      return { spectrum: dimensions('#drum-spectrum'), level: dimensions('#drum-level') };
    });
    expect(graphs.spectrum.height).toBeGreaterThan(90);
    expect(graphs.level.height).toBeGreaterThan(70);
    expect(graphs.spectrum.displayRatio).toBeCloseTo(graphs.spectrum.intrinsicRatio, 2);
    expect(graphs.level.displayRatio).toBeCloseTo(graphs.level.intrinsicRatio, 2);
    await page.screenshot({path: `.verification/drums-${size.width}.png`, fullPage:true});
  }
  expect(errors).toEqual([]);
});

test('tabs preserve audio, canvas and controls; playback, seek and settings stay connected', async ({page}) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#drum-spectrum')).toBeAttached();
  await page.getByText('테스트 신호', {exact:true}).click();
  await page.locator('#demo').click();
  await expect(page.locator('#toggle')).toBeEnabled({timeout:30000});
  await page.locator('#toggle').click();
  await expect(page.locator('#toggle')).toHaveAttribute('aria-label','일시정지');
  await expect.poll(() => page.locator('#audio').evaluate((node: HTMLAudioElement) => node.currentTime)).toBeGreaterThan(.2);
  await page.locator('#toggle').click();
  await page.locator('#scrubber').fill('5');
  const originalCanvas = await page.locator('#visualizer').elementHandle();
  const originalAudio = await page.locator('#audio').elementHandle();
  const pausedPixels = await page.locator('#visualizer').evaluate((node: HTMLCanvasElement) => node.toDataURL());
  await page.getByRole('tab',{name:'화면',exact:true}).click();
  await expect(page.locator('#bpm')).toBeVisible();
  await page.getByRole('tab',{name:'드럼',exact:true}).click();
  await expect(page.locator('#drum-spectrum')).toBeVisible();
  expect(await originalCanvas!.evaluate(node => node === document.querySelector('#visualizer'))).toBe(true);
  expect(await originalAudio!.evaluate(node => node === document.querySelector('#audio'))).toBe(true);
  expect(await page.locator('#visualizer').evaluate((node:HTMLCanvasElement) => node.toDataURL())).toBe(pausedPixels);
  await page.getByRole('tab',{name:'화면',exact:true}).click();
  await page.locator('#fps').selectOption('24');
  await expect(page.locator('#fps-readout')).toHaveText('24 FPS');
  const sensitivity = page.getByRole('slider',{name:'반응 감도'});
  await sensitivity.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#sensitivity')).toHaveValue('1.05');
  expect(await page.locator('#audio').evaluate((node:HTMLAudioElement) => node.currentTime)).toBeCloseTo(5,1);
  await page.locator('#bpm').fill('120');
  await expect(page.locator('#tempo-readout')).toHaveText('120 BPM');
  await page.getByRole('tab',{name:'오디오',exact:true}).click();
  await expect(page.locator('#monitor')).toBeEnabled();
  await expect(page.locator('#download-drums')).toBeVisible();
  await page.locator('#monitor').selectOption('drums');
  await expect(page.locator('#toggle')).toBeEnabled();
  await page.locator('#reset').click();
  await expect(page.locator('#scrubber')).toHaveValue('0');
  await page.screenshot({path:'.verification/workspace-loaded.png'});
  expect(errors).toEqual([]);
});

test('only the two-stem input is exposed and invalid stems show recoverable feedback', async ({page}) => {
  await page.goto('/');
  await expect(page.locator('#drum-spectrum')).toBeAttached();
  await expect(page.locator('#download-drums')).toBeHidden();
  await expect(page.locator('#audio-file')).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'분리된 스템 사용'})).toHaveCount(0);
  await page.locator('#drum-file').setInputFiles({name:'invalid-drums.wav',mimeType:'audio/wav',buffer:Buffer.from('invalid drums')});
  await expect(page.locator('#apply-stems')).toBeDisabled();
  await page.locator('#other-file').setInputFiles({name:'invalid-other.wav',mimeType:'audio/wav',buffer:Buffer.from('invalid other')});
  await expect(page.locator('#apply-stems')).toBeEnabled();
  await expect(page.getByTitle('invalid-drums.wav')).toBeVisible();
  await expect(page.getByTitle('invalid-other.wav')).toBeVisible();
  await page.locator('#apply-stems').click();
  await expect(page.locator('#load-status')).toHaveAttribute('data-error','true');
  await expect(page.locator('#toggle')).toBeDisabled();
  await page.getByRole('button',{name:'설정 패널 숨기기',exact:true}).click();
  await expect(page.locator('.inspector')).toBeHidden();
  await page.getByRole('button',{name:'설정 패널 표시',exact:true}).click();
  await expect(page.locator('.inspector')).toBeVisible();
});

test('two valid stems load as the primary source', async ({page}) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#drum-spectrum')).toBeAttached();
  await page.locator('#drum-file').setInputFiles({name:'drums.wav',mimeType:'audio/wav',buffer:wavTone(90)});
  await page.locator('#other-file').setInputFiles({name:'other.wav',mimeType:'audio/wav',buffer:wavTone(440)});
  await page.locator('#apply-stems').click();
  await expect(page.locator('#toggle')).toBeEnabled({timeout:30000});
  await expect(page.locator('#source-label')).toHaveText('drums.wav + other.wav');
  await expect(page.locator('#load-status')).not.toHaveAttribute('data-error','true');
  await expect(page.locator('#download-drums')).toBeVisible();
  await expect(page.locator('#download-other')).toBeVisible();
  await page.locator('#toggle').click();
  await expect.poll(() => page.locator('#audio').evaluate((node: HTMLAudioElement) => node.currentTime)).toBeGreaterThan(.1);
  await page.locator('#toggle').click();
  expect(errors).toEqual([]);
});
