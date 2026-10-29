import { defineConfig, devices } from '@playwright/test'

const navigationStages = ['valid', 'missing-account', 'invalid-account', 'missing-platform', 'invalid-platform', 'local-development']
const navigationStage = process.env.PRODUCT_NAVIGATION_STAGE
const googleStage = process.env.GOOGLE_ACCOUNT_BROWSER_STAGE === '1'
const localTarget = process.env.PRODUCT_NAVIGATION_LOCAL_TARGET ?? ''

if (navigationStage !== undefined && !navigationStages.includes(navigationStage)) {
  throw new Error('Unsupported product navigation browser stage')
}

if (navigationStage === 'local-development' && (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(localTarget)
  || Number(new URL(localTarget).port) > 65535 || [3000, 5173, 5188].includes(Number(new URL(localTarget).port)))) {
  throw new Error('Local navigation requires an owned loopback listener outside shared application ports')
}

export default defineConfig({
  testDir: './e2e',
  testMatch: navigationStage ? ['product-navigation.spec.ts'] : googleStage ? ['google-account-live.spec.ts'] : ['account-journeys-live.spec.ts', 'account-marketing-live.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120000,
  expect: { timeout: 10000 },
  reporter: './e2e/accountPrivacyReporter.ts',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:5173',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    launchOptions: navigationStage === 'local-development' ? {
      args: ['--no-proxy-server', '--host-resolver-rules=' + ['localhost:3000', '127.0.0.1:3000', 'product.localhost:3000']
        .map(host => `MAP ${host} ${new URL(localTarget).host}`).join(', ')],
    } : {},
  },
})
