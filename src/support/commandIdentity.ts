import { SUPPORT } from './constants'
import type { PendingSupportCommand } from './models'
import { supportId } from './parsing'

/** Binds a rejection to the exact transport bytes without retaining them in logs. */
export async function supportRequestHash(path: string, encoded: string): Promise<string> {
  const bytes = new TextEncoder().encode(`POST\n${SUPPORT.api}${path}\n${encoded}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')
}

export function pendingCommandPath(command: PendingSupportCommand): string {
  if (command.kind === 'request') {
    return '/requests'
  }

  const prefix = command.kind === 'approve' || command.kind === 'revoke' ? '/approvals/' : '/requests/'
  return prefix + supportId(command.grant, true) + '/' + command.kind
}
