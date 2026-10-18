import { defineConfig, devices } from '@playwright/test'

// Built, mocked both-palette regression lane. Real fixture specs remain owned by
// Infrastructure's supported live runner and their existing configurations.
export default defineConfig({
  metadata: { appMode: 'production' },
  testDir: './e2e', testIgnore: '**/*-live.spec.ts', fullyParallel: true,
  retries: 0, workers: 2, reporter: 'list',
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? '/tmp/story141-browser-results',
  use: { baseURL: 'http://127.0.0.1:5194', trace: 'retain-on-failure' },
  projects: ['light', 'dark'].map(mode => ({ name: mode, use: { ...devices['Desktop Chrome'], colorScheme: mode as 'light' | 'dark' } })),
  webServer: { command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 5194 --strictPort',
    url: 'http://127.0.0.1:5194', reuseExistingServer: false, env: { VITE_API_BASE_URL: '/api/backoffice' } },
})
