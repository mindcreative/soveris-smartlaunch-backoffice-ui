import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api/backoffice': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      '/api/billing': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
})
