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
  const [template, output, apiBase, upstream, challengeOrigin] = process.argv.slice(2)
  const connectOrigin = apiBase?.startsWith('/') && !apiBase.startsWith('//') && /^\/[a-z0-9/_-]*$/i.test(apiBase)
    ? '' : configurationOrigin(apiBase, true)
  const fixedUpstream = configurationOrigin(upstream, false)
  const frameOrigin = challengeOrigin ? configurationOrigin(challengeOrigin, false) : "'none'"

  if (challengeOrigin && (frameOrigin !== challengeOrigin ||
    !(challengeOrigin.startsWith('https://') || challengeOrigin === 'http://localhost:5190') ||
    new URL(challengeOrigin).hostname === '127.0.0.1')) {
    throw new Error('Invalid isolated challenge configuration.')
  }
  const source = await readFile(template, 'utf8')

  if (!source.includes('__GOOGLE_ACCOUNT_API_UPSTREAM__') || !source.includes('__ACCOUNT_API_CONNECT_ORIGIN__')) {
    throw new Error('Missing account proxy template.')
  }

  await writeFile(output, source.replaceAll('__GOOGLE_ACCOUNT_API_UPSTREAM__', fixedUpstream)
    .replaceAll('__ACCOUNT_API_CONNECT_ORIGIN__', connectOrigin).replaceAll('__ACCOUNT_CHALLENGE_ORIGIN__', frameOrigin))
} catch {
  process.stderr.write('Account proxy configuration could not be rendered.\n')
  process.exitCode = 64
}
