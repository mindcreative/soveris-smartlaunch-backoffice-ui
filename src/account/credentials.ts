import { ACCOUNT_LIMITS } from './constants/accountLifecycle'

export function accountEmail(input: string): string | null {
  if (input.length > ACCOUNT_LIMITS.maximumEmailInput) {
    return null
  }

  const trimmed = input.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '')

  if (/[^\x21-\x7e]/.test(trimmed)) {
    return null
  }

  const email = trimmed.toLowerCase()
  const parts = email.split('@')

  if (email.length > 254 || parts.length !== 2) {
    return null
  }

  const [local, domain] = parts
  const validLocal = local.length > 0 && local.length <= 64 &&
    /^[a-z0-9!#$%&'*+\-/=?^_`{|}~.]+$/.test(local) && !local.startsWith('.') && !local.endsWith('.') && !local.includes('..')
  const labels = domain.split('.')
  const validDomain = labels.length >= 2 &&
    labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))

  if (!validLocal || !validDomain) {
    return null
  }

  for (const label of labels.filter(value => value.startsWith('xn--'))) {
    try {
      if (new URL('https://' + label + '.example').hostname !== label + '.example') {
        return null
      }
    } catch {
      return null
    }
  }

  try {
    const host = new URL('https://' + domain).hostname

    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      return null
    }
  } catch {
    // URL's IPv4 parser rejects numeric DNS labels that the account API's
    // dot-atom/domain policy accepts. A-label validation above is independent.
  }

  return email
}

export function newPasswordError(password: string): string | null {
  const scalars = Array.from(password).length
  const invalidLength = scalars < ACCOUNT_LIMITS.minimumPasswordScalars || scalars > ACCOUNT_LIMITS.maximumPasswordScalars
  const invalidContent = /^[\s]*$/u.test(password) || /[\p{Cc}\p{Cs}]/u.test(password)

  if (invalidLength || invalidContent || new TextEncoder().encode(password).length > ACCOUNT_LIMITS.maximumPasswordBytes) {
    return 'Use 15–128 Unicode characters, at most 512 UTF-8 bytes, without control characters or an all-whitespace password.'
  }

  return null
}
