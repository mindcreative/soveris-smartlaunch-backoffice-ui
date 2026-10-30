import { readFile, writeFile } from 'node:fs/promises'

function origin(value) {
  const url = new URL(value)
  const loopback = ['127.0.0.1', 'localhost'].includes(url.hostname)

  if (value !== url.origin || !/^[a-z0-9.-]+$/i.test(url.hostname) || url.username || url.password ||
    !(url.protocol === 'https:' && !loopback || url.protocol === 'http:' && loopback)) {
    throw new Error('Invalid challenge origin.')
  }

  return url
}

try {
  const [template, nginxOutput, scriptOutput, accountValue, challengeValue] = process.argv.slice(2)
  const account = origin(accountValue)
  const challenge = origin(challengeValue)

  if (account.hostname === challenge.hostname) {
    throw new Error('The challenge requires a distinct host.')
  }

  const source = await readFile(template, 'utf8')

  if (!source.includes('__CHALLENGE_HOST__') || !source.includes('__ACCOUNT_ORIGIN__')) {
    throw new Error('Missing challenge template.')
  }

  await writeFile(nginxOutput, source.replaceAll('__CHALLENGE_HOST__', challenge.hostname).replaceAll('__ACCOUNT_ORIGIN__', account.origin))
  await writeFile(scriptOutput, `window.__accountChallenge = ${JSON.stringify({ parentOrigin: account.origin })};\n`)
} catch {
  process.stderr.write('Challenge configuration could not be rendered.\n')
  process.exitCode = 64
}
