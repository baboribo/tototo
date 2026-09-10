import { test, expect } from '@playwright/test';

test('unmount releases audio contexts, workers, object URLs and animation loops; remount plays again', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const workers = new Set<Worker>(),
      contexts = new Set<AudioContext>(),
      urls = new Set<string>(),
      frames = new Set<number>();
    const NativeWorker = window.Worker,
      NativeContext = window.AudioContext;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        workers.add(this);
      }
      terminate() {
        workers.delete(this);
        super.terminate();
      }
    };
    window.AudioContext = class extends NativeContext {
      constructor(options?: AudioContextOptions) {
        super(options);
        contexts.add(this);
      }
    };
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (object) => {
      const url = create(object);
      urls.add(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      urls.delete(url);
      revoke(url);
    };
    const request = window.requestAnimationFrame.bind(window),
      cancel = window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => {
      const id = request((time) => {
        frames.delete(id);
        callback(time);
      });
      frames.add(id);
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      frames.delete(id);
      cancel(id);
    };
    Object.assign(window, {
      resourceCounts: () => ({
        workers: workers.size,
        contexts: [...contexts].filter((context) => context.state !== 'closed').length,
        urls: urls.size,
        frames: frames.size,
      }),
    });
  });
  await page.goto('/tests/fixtures/lifecycle.html');
  for (let run = 0; run < 2; run++) {
    await page.locator('#mount-workspace').click();
    await page.getByText('테스트 신호', { exact: true }).click();
    await page.locator('#demo').click();
    await expect(page.locator('#toggle')).toBeEnabled({ timeout: 30000 });
    await page.locator('#toggle').click();
    await expect
      .poll(() => page.locator('#audio').evaluate((audio: HTMLAudioElement) => audio.currentTime))
      .toBeGreaterThan(0.1);
    await page.locator('#unmount-workspace').click();
    await expect(page.locator('#workspace')).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as unknown as { resourceCounts: () => object }).resourceCounts(),
        ),
      )
      .toEqual({ workers: 0, contexts: 0, urls: 0, frames: 0 });
  }
  // Tear down immediately while decode/analysis is still pending.
  await page.locator('#mount-workspace').click();
  await page.getByText('테스트 신호', { exact: true }).click();
  await page.locator('#demo').click();
  await page.locator('#unmount-workspace').click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { resourceCounts: () => object }).resourceCounts()),
    )
    .toEqual({ workers: 0, contexts: 0, urls: 0, frames: 0 });
  expect(errors).toEqual([]);
});
