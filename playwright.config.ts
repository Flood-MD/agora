import { defineConfig, devices } from '@playwright/test';

const PORT = 8099;

// Runs against the production build (`pnpm build` first) with the offline mock provider.
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `rm -rf e2e/.data && node --disable-warning=ExperimentalWarning apps/server/dist/index.js`,
    env: {
      MOCK_PROVIDER: '1',
      MOCK_DELAY_MS: '15',
      DATA_DIR: 'e2e/.data',
      PORT: String(PORT),
      HOST: '127.0.0.1',
    },
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
  },
});
