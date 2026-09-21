import { defineConfig, devices } from '@playwright/test';

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 7,
  timeout: 35000,
  reporter: 'html',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'npm run dev:server & npx wait-on http://127.0.0.1:3002/maps/sprites/light.json && npm run dev:client',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env.CI,
      env: {
        NODE_ENV: 'development',
        ALLOW_MOCK_AUTH: 'true',
        VITE_MOCK_AUTH: 'true',
        VITE_GOOGLE_CLIENT_ID: 'MOCK_CLIENT_ID',
        GOOGLE_CLIENT_ID: 'MOCK_CLIENT_ID',
      },
    }
  ],
  onError: async ({ error, test }) => {
    if (test) {
      // Assuming there is an API endpoint to delete a map by its ID
      const mapId = test.title; // Replace with actual logic to get the map ID
      await fetch(`http://127.0.0.1:3002/maps/${mapId}`, { method: 'DELETE' });
    }
  },
});
