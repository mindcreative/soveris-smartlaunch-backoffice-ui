import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const apiBaseUrl = process.env.VITE_API_BASE_URL || 'http://localhost:5000'
const parsedApiBaseUrl = new URL(apiBaseUrl, 'http://localhost:5000')
const apiBasePath = parsedApiBaseUrl.pathname
const apiProxyTarget = apiBaseUrl.startsWith('/') ? 'http://localhost:5000' : parsedApiBaseUrl.origin
const googlePrefix = '/api/backoffice/auth/google/'
const googleUpstream = process.env.GOOGLE_ACCOUNT_API_UPSTREAM
const challengeOrigin = process.env.ACCOUNT_CHALLENGE_ORIGIN || ''
const admissionPaths = ['/api/backoffice/auth/admission/context', '/api/backoffice/auth/register']
const googleMethods = new Map(['context', 'callback', 'start', 'complete', 'cancel', 'link-proof', 'link']
  .map(action => [googlePrefix + action, action === 'context' ? 'GET' : 'POST']))
const accountDocument = /^\/(signup|login|check-email|verify-email|forgot-password|reset-password|account\/google\/(complete|link))\/*$/i

if (challengeOrigin) {
  const child = new URL(challengeOrigin)

  if (child.origin !== challengeOrigin || child.hostname === '127.0.0.1' || child.username || child.password ||
    !(child.protocol === 'https:' || challengeOrigin === 'http://localhost:5190')) {
    throw new Error('Invalid isolated challenge origin.')
  }
}

function proxyHeaders(proxy: import('vite').HttpProxy.Server) {
  proxy.on('error', (_error, _request, response) => {
    if ('writeHead' in response && !response.headersSent) {
      response.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
      response.end('{"code":"account_temporarily_unavailable"}')
    }
  })
  proxy.on('proxyReq', (outgoing, request) => {
    for (const header of ['forwarded', 'x-real-ip', 'cf-connecting-ip', 'x-forwarded-host', 'x-forwarded-proto']) {
      outgoing.removeHeader(header)
    }

    outgoing.setHeader('X-Forwarded-For', request.socket.remoteAddress || '')

    if (admissionPaths.includes(request.url || '')) {
      outgoing.removeHeader('Authorization')
    }
  })
}


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
        const target = request.url || ''
        const parsed = new URL(target, 'http://127.0.0.1:5173')
        let decoded = target
        try {
          decoded = decodeURIComponent(decodeURIComponent(target)).replaceAll('\\', '/')
        } catch {
          response.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
          response.end('{"code":"challenge_required"}')

          return
        }
        const admission = /^\/api\/backoffice\/auth\/(admission|register)/i.test(parsed.pathname) ||
          /^\/api\/backoffice\/auth\/(admission|register)/i.test(decoded)
        const google = /^\/api\/backoffice\/auth\/google/i.test(parsed.pathname) || /^\/api\/backoffice\/auth\/google/i.test(decoded)
        const protectedRoute = admission || google
        const expectedMethod = admission ? 'POST' : googleMethods.get(target)
        const maximumBody = admission ? 16384 : 8192
        const length = request.headers['content-length']
        const validLength = typeof length === 'string' && /^\d{1,5}$/.test(length) && Number(length) <= maximumBody

        if (protectedRoute && ((admission && !admissionPaths.includes(target)) || !expectedMethod || request.method !== expectedMethod ||
          request.headers['transfer-encoding'] || expectedMethod === 'POST' && !validLength)) {
          response.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
          response.end('{"code":"challenge_required"}')

          return
        }

        if (accountDocument.test(parsed.pathname)) {
          const frame = target === '/signup' && challengeOrigin ? challengeOrigin : "'none'"
          response.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; connect-src 'self' ${parsedApiBaseUrl.origin}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-src ${frame}; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`)
          response.setHeader('Cache-Control', 'no-store')
          response.setHeader('Referrer-Policy', 'no-referrer')
        }

        if (!googleUpstream && protectedRoute) {
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
    // Account CSP excludes the inline Fast Refresh preamble.
    hmr: false,
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      ...(googleUpstream ? {
        [googlePrefix]: { target: googleUpstream, changeOrigin: true, followRedirects: false, proxyTimeout: 10000, configure: proxyHeaders },
        ...Object.fromEntries(admissionPaths.map(path => [path, {
          target: googleUpstream, changeOrigin: true, followRedirects: false, proxyTimeout: 10000, configure: proxyHeaders,
        }])),
      } : {}),
      [apiBasePath]: {
        target: apiProxyTarget,
        changeOrigin: true,
        rewritePath: '',
      },
    },
  },
})
