import { defineConfig, devices } from '@playwright/test'

const uiPort = process.env.PLAYWRIGHT_UI_PORT ?? '5173'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${uiPort}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${uiPort} --strictPort`,
    url: `http://127.0.0.1:${uiPort}`,
    reuseExistingServer: !process.env.CI && !process.env.PLAYWRIGHT_UI_PORT,
    env: {
      VITE_API_BASE_URL: '/api/backoffice',
    },
  },
})
