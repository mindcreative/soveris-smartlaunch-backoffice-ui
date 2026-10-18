import {defineConfig, devices} from '@playwright/test'

// Canonical report functional/performance lane. Build current sources before
// serving so the 100ms/500ms budgets cannot measure stale or development assets.
export default defineConfig({
  testDir: './e2e',
  testMatch: ['billing-reports.spec.ts', 'billing-reports-performance.spec.ts'],
  metadata: { appMode: 'production' },
  fullyParallel: false, workers: 1, retries: 0, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5174', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: {...devices['Desktop Chrome']} }],
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 5174 --strictPort',
    url: 'http://127.0.0.1:5174', reuseExistingServer: false,
    env: { VITE_API_BASE_URL: '/api/backoffice' },
  },
})
