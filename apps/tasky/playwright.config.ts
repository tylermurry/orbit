import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const outputDir = fileURLToPath(new URL('./test-results/', import.meta.url));

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  outputDir: `${outputDir}/playwright`,
  reporter: [
    ['list'],
    ['junit', { outputFile: process.env.PLAYWRIGHT_JUNIT_OUTPUT_FILE ?? `${outputDir}/e2e.junit.xml` }],
    ['html', { outputFolder: `${outputDir}/e2e`, open: 'never' }],
    ['blob', { outputDir: `${outputDir}/blob-report` }],
  ],
  use: {
    baseURL: 'http://localhost:5174',
    timezoneId: 'America/New_York',
    locale: 'en-US',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx vite --port 5174 --strictPort',
    url: 'http://localhost:5174',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
