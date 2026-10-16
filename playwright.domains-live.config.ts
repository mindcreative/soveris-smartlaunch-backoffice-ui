import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './e2e', testMatch: 'domains-live.spec.ts', fullyParallel: false, retries: 0, reporter: 'list', timeout: 180000,
  use: { baseURL: 'http://127.0.0.1:5187', trace: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'npx vite preview --config vite.domains-live.config.ts --host 127.0.0.1 --port 5187 --strictPort', url: 'http://127.0.0.1:5187', reuseExistingServer: false,
    env: { DOMAINS_UI_BUILD_DIR: process.env.DOMAINS_UI_BUILD_DIR!, DOMAINS_BROWSER_API_URL: process.env.DOMAINS_BROWSER_API_URL! } },
})
