import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const apiBaseUrl = process.env.VITE_API_BASE_URL || 'http://localhost:5000'
const parsedApiBaseUrl = new URL(apiBaseUrl, 'http://localhost:5000')
const apiBasePath = parsedApiBaseUrl.pathname
const apiProxyTarget = apiBaseUrl.startsWith('/') ? 'http://localhost:5000' : parsedApiBaseUrl.origin

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      [apiBasePath]: {
        target: apiProxyTarget,
        changeOrigin: true,
        rewritePath: '',
      },
    },
  },
})
