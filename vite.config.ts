import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const apiBaseUrl = process.env.VITE_API_BASE_URL || 'http://localhost:5000'
const parsedApiBaseUrl = new URL(apiBaseUrl, 'http://localhost:5000')
const apiBasePath = parsedApiBaseUrl.pathname
const apiProxyTarget = apiBaseUrl.startsWith('/') ? 'http://localhost:5000' : parsedApiBaseUrl.origin
const googlePrefix = '/api/backoffice/auth/google/'
const googleUpstream = process.env.GOOGLE_ACCOUNT_API_UPSTREAM

if (googleUpstream) {
  const fixed = new URL(googleUpstream)

  if (!['http:', 'https:'].includes(fixed.protocol) || fixed.username || fixed.password || fixed.pathname !== '/' || fixed.search || fixed.hash) {
    throw new Error('Google account proxy requires a fixed upstream origin.')
  }
}

export default defineConfig({
  plugins: [react(), {
    name: 'google-account-origin-boundary',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!googleUpstream && request.url?.startsWith(googlePrefix)) {
          response.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
          response.end('{"code":"account_flow_unavailable"}')

          return
        }

        next()
      })
    },
  }],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // These local generated CommonJS modules also need development prebundling.
  optimizeDeps: {
    include: [
      '@/contracts/product-content/generated/validators.cjs',
      '@/contracts/reconciliation/generated/validators.cjs',
    ],
  },
  build: {
    commonjsOptions: { include: [/node_modules/, /src\/contracts\/(product-content|reconciliation)\/generated\/validators\.cjs$/] },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      ...(googleUpstream ? { [googlePrefix]: { target: googleUpstream, changeOrigin: true, followRedirects: false } } : {}),
      [apiBasePath]: {
        target: apiProxyTarget,
        changeOrigin: true,
        rewritePath: '',
      },
    },
  },
})
