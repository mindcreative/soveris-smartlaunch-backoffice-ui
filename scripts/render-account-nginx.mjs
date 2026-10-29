import { readFile, writeFile } from 'node:fs/promises'

function configurationOrigin(value, allowPath) {
  const url = new URL(value)
  const safeHost = /^[a-z0-9.:[\]-]+$/i.test(url.hostname)

  if (!['http:', 'https:'].includes(url.protocol) || !safeHost || url.username || url.password || url.search || url.hash ||
    (!allowPath && url.pathname !== '/') || /\s/.test(value)) {
    throw new Error('Invalid account proxy configuration.')
  }

  return url.origin
}

try {
  const [template, output, apiBase, upstream] = process.argv.slice(2)
  const connectOrigin = apiBase?.startsWith('/') && !apiBase.startsWith('//') && /^\/[a-z0-9/_-]*$/i.test(apiBase)
    ? '' : configurationOrigin(apiBase, true)
  const fixedUpstream = configurationOrigin(upstream, false)
  const source = await readFile(template, 'utf8')

  if (!source.includes('__GOOGLE_ACCOUNT_API_UPSTREAM__') || !source.includes('__ACCOUNT_API_CONNECT_ORIGIN__')) {
    throw new Error('Missing account proxy template.')
  }

  await writeFile(output, source.replaceAll('__GOOGLE_ACCOUNT_API_UPSTREAM__', fixedUpstream)
    .replaceAll('__ACCOUNT_API_CONNECT_ORIGIN__', connectOrigin))
} catch {
  process.stderr.write('Account proxy configuration could not be rendered.\n')
  process.exitCode = 64
}
