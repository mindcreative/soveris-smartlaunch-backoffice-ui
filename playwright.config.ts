import { defineConfig, devices } from '@playwright/test'

const uiPort = process.env.PLAYWRIGHT_UI_PORT ?? '5173'

export default defineConfig({
  testDir: './e2e',
  // Appearance and performance acceptance require built assets. Performance
  // runs in playwright.reports.config.ts and the full appearance matrix.
  // Navigation stages require the canonical Infrastructure fixture and run
  // through playwright.account-live.config.ts, alongside the other live lanes.
  testIgnore: ['**/*-live.spec.ts', '**/product-navigation.spec.ts', '**/appearance.spec.ts', '**/appearance-session.spec.ts', '**/billing-reports-performance.spec.ts'],
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
