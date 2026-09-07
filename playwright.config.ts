import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  outputDir: '.verification/browser',
  timeout: 45000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4180', viewport: { width: 1280, height: 800 }, screenshot: 'only-on-failure' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 4180 --strictPort', url: 'http://127.0.0.1:4180' },
});
