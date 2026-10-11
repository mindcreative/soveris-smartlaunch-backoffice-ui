import { defineConfig } from '@playwright/test'
import base from './playwright.config'

// Own a freshly built preview. These suites mock transport; this lane proves
// built UI behavior, never live DB/provider or public Next delivery acceptance.
export default defineConfig({
  ...base,
  testMatch: ['generated-product-images.spec.ts', 'products.spec.ts', 'products-ai-generation.spec.ts', 'ai-image-jobs.spec.ts'],
  use: { ...base.use, baseURL: 'http://127.0.0.1:5188' },
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 5188 --strictPort',
    url: 'http://127.0.0.1:5188',
    reuseExistingServer: false,
    env: { VITE_API_BASE_URL: '/api/backoffice' },
  },
})
