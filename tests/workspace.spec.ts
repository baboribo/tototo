import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function loadShortTrack(page: import('@playwright/test').Page, seconds = 2) {
  await page.goto('/');
  await page
    .locator('#drum-file')
    .setInputFiles({ name: 'drums.wav', mimeType: 'audio/wav', buffer: wavTone(90, seconds) });
  await page
    .locator('#other-file')
    .setInputFiles({ name: 'other.wav', mimeType: 'audio/wav', buffer: wavTone(440, seconds) });
  await page.locator('#apply-stems').click();
  await page.locator('#choose-live').click();
  await expect(page.locator('#toggle')).toBeEnabled({ timeout: 30000 });
}

async function useRealtimeExport(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'VideoEncoder', { value: undefined, configurable: true });
    Object.defineProperty(window, 'MediaStreamTrackGenerator', {
      value: undefined,
      configurable: true,
    });
  });
}

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
    const envelope =
      index % Math.floor(sampleRate / 2) < 900
        ? Math.exp(-(index % Math.floor(sampleRate / 2)) / 230)
        : 0.08;
    const sample = Math.sin((2 * Math.PI * frequency * index) / sampleRate) * envelope;
    buffer.writeInt16LE(Math.round(sample * 24000), 44 + index * 2);
  }
  return buffer;
}

test('layout keeps preview and transport on screen at desktop and narrow widths', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#drum-spectrum')).toBeAttached();
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
    { width: 900, height: 600 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await page.getByRole('tab', { name: '오디오', exact: true }).click();
    const layout = await page.evaluate(() => {
      const canvas = document.querySelector('#visualizer')!.getBoundingClientRect();
      const player = document.querySelector('.transport')!.getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        canvasBottom: canvas.bottom,
        playerTop: player.top,
        playerBottom: player.bottom,
        ratio: canvas.width / canvas.height,
      };
    });
    expect(layout.overflow).toBe(false);
    expect(layout.ratio).toBeCloseTo(4 / 3, 2);
    expect(layout.canvasBottom).toBeLessThanOrEqual(layout.playerTop);
    if (size.width > 720) expect(layout.playerBottom).toBeLessThanOrEqual(size.height);
    await page.screenshot({ path: `.verification/workspace-${size.width}.png`, fullPage: true });
    await page.getByRole('tab', { name: '화면', exact: true }).click();
    await expect(page.getByRole('slider', { name: '반응 감도' })).toBeVisible();
    await page.screenshot({ path: `.verification/visual-${size.width}.png`, fullPage: true });
    await page.getByRole('tab', { name: '드럼', exact: true }).click();
    await expect(page.locator('#drum-spectrum')).toBeVisible();
    const graphs = await page.evaluate(() => {
      const dimensions = (id: string) => {
        const canvas = document.querySelector<HTMLCanvasElement>(id)!;
        const rect = canvas.getBoundingClientRect();
        return {
          width: rect.width,
          height: rect.height,
          intrinsicRatio: canvas.width / canvas.height,
          displayRatio: rect.width / rect.height,
        };
      };
      return { spectrum: dimensions('#drum-spectrum'), level: dimensions('#drum-level') };
    });
    expect(graphs.spectrum.height).toBeGreaterThan(90);
    expect(graphs.level.height).toBeGreaterThan(70);
    expect(graphs.spectrum.displayRatio).toBeCloseTo(graphs.spectrum.intrinsicRatio, 2);
    expect(graphs.level.displayRatio).toBeCloseTo(graphs.level.intrinsicRatio, 2);
    await page.screenshot({ path: `.verification/drums-${size.width}.png`, fullPage: true });
  }
  expect(errors).toEqual([]);
});

test('tabs preserve audio, canvas and controls; playback, seek and settings stay connected', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#drum-spectrum')).toBeAttached();
  await page.getByText('테스트 신호', { exact: true }).click();
  await page.locator('#demo').click();
  await expect(page.locator('#toggle')).toBeEnabled({ timeout: 30000 });
  await page.locator('#toggle').click();
  await expect(page.locator('#toggle')).toHaveAttribute('aria-label', '일시정지');
  await expect
    .poll(() => page.locator('#audio').evaluate((node: HTMLAudioElement) => node.currentTime))
    .toBeGreaterThan(0.2);
  await page.locator('#toggle').click();
  await page.locator('#scrubber').fill('5');
  const originalCanvas = await page.locator('#visualizer').elementHandle();
  const originalAudio = await page.locator('#audio').elementHandle();
  const pausedPixels = await page
    .locator('#visualizer')
    .evaluate((node: HTMLCanvasElement) => node.toDataURL());
  await page.getByRole('tab', { name: '화면', exact: true }).click();
  await expect(page.locator('#bpm')).toBeVisible();
  await page.getByRole('tab', { name: '드럼', exact: true }).click();
  await expect(page.locator('#drum-spectrum')).toBeVisible();
  expect(
    await originalCanvas!.evaluate((node) => node === document.querySelector('#visualizer')),
  ).toBe(true);
  expect(await originalAudio!.evaluate((node) => node === document.querySelector('#audio'))).toBe(
    true,
  );
  expect(
    await page.locator('#visualizer').evaluate((node: HTMLCanvasElement) => node.toDataURL()),
  ).toBe(pausedPixels);
  await page.getByRole('tab', { name: '화면', exact: true }).click();
  await page.locator('#fps').selectOption('24');
  await expect(page.locator('#fps-readout')).toHaveText('24 FPS');
  const sensitivity = page.getByRole('slider', { name: '반응 감도' });
  await sensitivity.focus();
  await page.keyboard.press('ArrowRight');
  await expect(sensitivity).toHaveAttribute('aria-valuenow', '1.05');
  const tileFade = page.getByRole('slider', { name: '타일 페이드' });
  await tileFade.focus();
  await page.keyboard.press('ArrowRight');
  await expect(tileFade).toHaveAttribute('aria-valuenow', '0.35');
  expect(
    await page.locator('#audio').evaluate((node: HTMLAudioElement) => node.currentTime),
  ).toBeCloseTo(5, 1);
  await page.locator('#bpm').fill('120');
  await expect(page.locator('#tempo-readout')).toHaveText('120 BPM');
  await page.getByRole('tab', { name: '오디오', exact: true }).click();
  await expect(page.locator('#monitor')).toBeEnabled();
  await expect(page.locator('#download-drums')).toBeVisible();
  await page.locator('#monitor').selectOption('drums');
  await expect(page.locator('#toggle')).toBeEnabled();
  await page.locator('#reset').click();
  await expect(page.locator('#scrubber')).toHaveValue('0');
  await page.screenshot({ path: '.verification/workspace-loaded.png' });
  expect(errors).toEqual([]);
});

test('only the two-stem input is exposed and invalid stems show recoverable feedback', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#drum-spectrum')).toBeAttached();
  await expect(page.locator('#download-drums')).toBeHidden();
  await expect(page.locator('#audio-file')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '분리된 스템 사용' })).toHaveCount(0);
  await page.locator('#drum-file').setInputFiles({
    name: 'invalid-drums.wav',
    mimeType: 'audio/wav',
    buffer: Buffer.from('invalid drums'),
  });
  await expect(page.locator('#apply-stems')).toBeDisabled();
  await page.locator('#other-file').setInputFiles({
    name: 'invalid-other.wav',
    mimeType: 'audio/wav',
    buffer: Buffer.from('invalid other'),
  });
  await expect(page.locator('#apply-stems')).toBeEnabled();
  await expect(page.getByTitle('invalid-drums.wav')).toBeVisible();
  await expect(page.getByTitle('invalid-other.wav')).toBeVisible();
  await page.locator('#apply-stems').click();
  await page.locator('#choose-live').click();
  await expect(page.locator('#load-status')).toHaveAttribute('data-error', 'true');
  await expect(page.locator('#toggle')).toBeDisabled();
  await page.getByRole('button', { name: '설정 패널 숨기기', exact: true }).click();
  await expect(page.locator('.inspector')).toBeHidden();
  await page.getByRole('button', { name: '설정 패널 표시', exact: true }).click();
  await expect(page.locator('.inspector')).toBeVisible();
});

test('two valid stems load as the primary source', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#drum-spectrum')).toBeAttached();
  await page
    .locator('#drum-file')
    .setInputFiles({ name: 'drums.wav', mimeType: 'audio/wav', buffer: wavTone(90) });
  await page
    .locator('#other-file')
    .setInputFiles({ name: 'other.wav', mimeType: 'audio/wav', buffer: wavTone(440) });
  await page.locator('#apply-stems').click();
  await expect(page.getByRole('dialog', { name: '타일 생성 방식' })).toBeVisible();
  await page.locator('#cancel-tile-mode').click();
  await expect(page.locator('#source-label')).toHaveText('파일 없음');
  await page.locator('#apply-stems').click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.locator('#apply-stems').click();
  await page.locator('#choose-live').click();
  await expect(page.locator('#toggle')).toBeEnabled({ timeout: 30000 });
  await expect(page.locator('#source-label')).toHaveText('drums.wav + other.wav');
  await expect(page.locator('#load-status')).not.toHaveAttribute('data-error', 'true');
  await expect(page.locator('#download-drums')).toBeVisible();
  await expect(page.locator('#download-other')).toBeVisible();
  await expect(page.locator('#export-video')).toBeEnabled();
  await expect(page.locator('#export-video')).toContainText('동영상 내보내기');
  await page.locator('#toggle').click();
  await expect
    .poll(() => page.locator('#audio').evaluate((node: HTMLAudioElement) => node.currentTime))
    .toBeGreaterThan(0.1);
  await page.locator('#toggle').click();
  expect(errors).toEqual([]);
});

test('preload prepares the full song, seeks deterministically and rebuilds after settings change', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#drum-spectrum')).toBeAttached();
  await page
    .locator('#drum-file')
    .setInputFiles({ name: 'drums.wav', mimeType: 'audio/wav', buffer: wavTone(90, 4) });
  await page
    .locator('#other-file')
    .setInputFiles({ name: 'other.wav', mimeType: 'audio/wav', buffer: wavTone(440, 4) });
  await page.locator('#apply-stems').click();
  await page.screenshot({ path: '.verification/tile-mode-dialog.png' });
  await page.locator('#choose-preload').click();
  await expect(page.locator('#tile-mode-readout')).toContainText('준비 완료', { timeout: 30000 });
  await expect(page.locator('#toggle')).toBeEnabled();
  await page.locator('#scrubber').fill('1');
  const pixels = await page
    .locator('#visualizer')
    .evaluate((c: HTMLCanvasElement) => c.toDataURL());
  await page.locator('#scrubber').fill('3');
  await page.locator('#scrubber').fill('1');
  expect(await page.locator('#visualizer').evaluate((c: HTMLCanvasElement) => c.toDataURL())).toBe(
    pixels,
  );
  await page.getByRole('tab', { name: '화면', exact: true }).click();
  await page.locator('#bpm').fill('120');
  await expect(page.locator('#tile-mode-readout')).toContainText('준비 완료', { timeout: 30000 });
  await expect(page.locator('#toggle')).toBeEnabled();
  await expect(page.locator('#scrubber')).toHaveValue('1');
  await page.locator('#toggle').click();
  await expect
    .poll(() => page.locator('#audio').evaluate((a: HTMLAudioElement) => a.currentTime))
    .toBeGreaterThan(1.1);
  await page.locator('#toggle').click();
  await page.getByRole('tab', { name: '오디오', exact: true }).click();
  await page.locator('#apply-stems').click();
  await page.locator('#choose-live').click();
  await expect(page.locator('#toggle')).toBeEnabled({ timeout: 30000 });
  await expect(page.locator('#tile-mode-readout')).toContainText('즉흥 생성');
  expect(errors).toEqual([]);
});

test('drum controls keep channel values, graph threshold and reset synchronized', async ({
  page,
}) => {
  await loadShortTrack(page);
  await page.getByRole('tab', { name: '드럼', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'KICK 분석 게인 dB' }).fill('6');
  await page.getByRole('spinbutton', { name: 'KICK 감지 임계값' }).fill('0.4');
  const threshold = page.getByRole('slider', { name: '선택 드럼 감지 임계값' });
  await expect(threshold).toHaveAttribute('aria-valuenow', '0.4');
  await threshold.focus();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('spinbutton', { name: 'KICK 감지 임계값' })).toHaveValue('0.41');
  await page.getByRole('button', { name: 'SNARE', exact: true }).click();
  await page.getByRole('button', { name: 'KICK', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'KICK 분석 게인 dB' })).toHaveValue('6');
  await page.getByRole('checkbox', { name: '타일·펜 반응 켜기' }).uncheck();
  await page.locator('#eq-reset').click();
  await expect(page.getByRole('checkbox', { name: '타일·펜 반응 켜기' })).toBeChecked();
  await expect(page.getByRole('spinbutton', { name: 'KICK 분석 게인 dB' })).toHaveValue('0');
  await expect(threshold).toHaveAttribute('aria-valuenow', '0.16');
  await page.locator('#eq-solo').click();
  await expect(page.locator('#eq-solo')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#eq-solo').click();
  await expect(page.locator('#eq-solo')).toHaveAttribute('aria-pressed', 'false');
});

test('export downloads a playable, seekable video and restores the paused position', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await loadShortTrack(page);
  await page.locator('#scrubber').fill('0.75');
  const downloadEvent = page.waitForEvent('download');
  await page.locator('#export-video').click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/-motion\.(mp4|webm)$/);
  const path = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(path);
  const bytes = await readFile(path);
  expect(bytes.length).toBeGreaterThan(1000);
  const metadata = await page.evaluate(
    async ({ bytes, mime }) => {
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mime }));
      const video = document.createElement('video');
      video.muted = true;
      video.src = url;
      try {
        await new Promise<void>((resolve, reject) => {
          video.onloadedmetadata = () => resolve();
          video.onerror = () => reject(new Error('Export is not playable'));
        });
        const duration = video.duration;
        await new Promise<void>((resolve, reject) => {
          video.onseeked = () => resolve();
          video.onerror = () => reject(new Error('Export is not seekable'));
          video.currentTime = 1;
        });
        return {
          duration,
          time: video.currentTime,
          width: video.videoWidth,
          height: video.videoHeight,
        };
      } finally {
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(url);
      }
    },
    {
      bytes: [...bytes],
      mime: download.suggestedFilename().endsWith('.mp4') ? 'video/mp4' : 'video/webm',
    },
  );
  expect(metadata.duration).toBeGreaterThan(1.5);
  expect(metadata.duration).toBeLessThan(3);
  expect(metadata.time).toBeCloseTo(1, 1);
  expect(metadata.width).toBe(960);
  expect(metadata.height).toBe(720);
  await page.locator('#cancel-export').click();
  await expect(page.locator('#scrubber')).toHaveValue('0.75');
  await expect(page.locator('#toggle')).toHaveAttribute('aria-label', '재생');
  await expect(page.locator('#export-video')).toBeEnabled();
  expect(errors).toEqual([]);
});

test('canceling fallback export stops recording, skips download and restores controls', async ({
  page,
}) => {
  await useRealtimeExport(page);
  await loadShortTrack(page, 5);
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.locator('#scrubber').fill('1.25');
  await page.locator('#export-video').click();
  await expect(page.locator('#export-sheet-status')).toContainText('녹화');
  await expect(page.locator('#drum-file')).toBeDisabled();
  await page.locator('#cancel-export').click();
  await expect(page.locator('#export-sheet')).not.toBeVisible();
  await expect(page.locator('#load-status')).toContainText('취소');
  await expect(page.locator('#scrubber')).toHaveValue('1.25');
  await expect(page.locator('#export-video')).toBeEnabled();
  await page.locator('#toggle').click();
  await expect
    .poll(() => page.locator('#audio').evaluate((audio: HTMLAudioElement) => audio.currentTime))
    .toBeGreaterThan(1.4);
  await page.locator('#toggle').click();
  expect(downloads).toBe(0);
});

test('recorder playback failure restores the workspace and permits another export', async ({
  page,
}) => {
  await useRealtimeExport(page);
  await loadShortTrack(page);
  await page.locator('#scrubber').fill('0.5');
  await page.evaluate(() => {
    const original = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      HTMLMediaElement.prototype.play = original;
      return Promise.reject(new Error('Forced playback failure'));
    };
  });
  await page.locator('#export-video').click();
  await expect(page.locator('#load-status')).toHaveAttribute('data-error', 'true');
  await expect(page.locator('#scrubber')).toHaveValue('0.5');
  await expect(page.locator('#export-video')).toBeEnabled();
  const download = page.waitForEvent('download');
  await page.locator('#export-video').click();
  await download;
  await expect(page.locator('#export-progress-label')).toHaveText('100%');
});
