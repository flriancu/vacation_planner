import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/`,
    trace: 'retain-on-failure',
    // Tests never reach the internet: everything but this machine goes to a proxy that isn't
    // there, so anything a fake's routes miss (a CORS preflight, a request sent while a page
    // unloads) fails here instead of reaching Google. Works the same in every browser engine.
    proxy: { server: 'http://127.0.0.1:1', bypass: 'localhost,127.0.0.1' },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    // Always a fresh build: a leftover server on the port would otherwise serve stale code.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
