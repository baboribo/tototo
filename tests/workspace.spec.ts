import { test, expect } from '@playwright/test';

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

test('invalid files show recoverable feedback and file picker works from any tab', async ({page}) => {
  await page.goto('/');
  await expect(page.locator('#drum-spectrum')).toBeAttached();
  await expect(page.locator('#download-drums')).toBeHidden();
  await page.getByRole('tab',{name:'화면',exact:true}).click();
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button',{name:'파일 열기',exact:true}).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({name:'invalid.wav',mimeType:'audio/wav',buffer:Buffer.from('invalid audio')});
  await expect(page.locator('#load-status')).toHaveAttribute('data-error','true');
  await expect(page.locator('#toggle')).toBeDisabled();
  await page.getByRole('button',{name:'설정 패널 숨기기',exact:true}).click();
  await expect(page.locator('.inspector')).toBeHidden();
  await page.getByRole('button',{name:'설정 패널 표시',exact:true}).click();
  await expect(page.locator('.inspector')).toBeVisible();
});
