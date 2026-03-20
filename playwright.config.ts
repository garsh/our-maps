import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 60000,
  reporter: 'html',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'npm run dev:server & npx wait-on http://127.0.0.1:3001/api/hello && npm run dev:client',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env.CI,
      env: {
        VITE_MOCK_AUTH: 'true',
        GOOGLE_CLIENT_ID: 'MOCK_CLIENT_ID',
      },
    }
  ],
});
