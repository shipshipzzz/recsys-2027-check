import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const chrome =
  process.platform === 'win32' &&
  existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')
    ? 'chrome'
    : undefined;
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  workers: 2,
  timeout: 30000,
  expect: { timeout: 5000 },
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  outputDir: 'test-results/browser',
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/e2e-results.json' }],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4179/recsys-2027-check/',
    channel: process.env.PLAYWRIGHT_CHANNEL || chrome,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
    locale: 'zh-CN',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: 'mobile',
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: {
    command: 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4179 --strictPort',
    url: 'http://127.0.0.1:4179/recsys-2027-check/',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
