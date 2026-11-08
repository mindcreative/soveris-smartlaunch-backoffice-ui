import { defineConfig, devices } from '@playwright/test'

if (process.env.ACCOUNT_SUPPORT_BROWSER !== '1' || !process.env.ACCOUNT_SUPPORT_CONTEXT || !process.env.ACCOUNT_SUPPORT_BRIDGE) {
  throw new Error('Canonical owned support browser context is required')
}

const origin = process.env.ACCOUNT_SUPPORT_ORIGIN ?? 'http://127.0.0.1:5173'
const target = new URL(origin)

if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || target.origin !== origin || !target.port) {
  throw new Error('Expected one owned support loopback origin')
}

export default defineConfig({
  testDir: './e2e',
  testMatch: ['support-live.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180000,
  expect: { timeout: 10000 },
  reporter: './e2e/accountPrivacyReporter.ts',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: origin,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
})
