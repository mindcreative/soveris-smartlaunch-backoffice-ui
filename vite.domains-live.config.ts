import { defineConfig } from 'vite'
import base from './vite.config'
export default defineConfig({ ...base,
  build: { ...base.build, outDir: process.env.DOMAINS_UI_BUILD_DIR ?? 'dist' },
  preview: { proxy: { '/api': { target: process.env.DOMAINS_BROWSER_API_URL ?? 'http://127.0.0.1:15117', changeOrigin: true } } },
})
