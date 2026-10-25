import { describe, expect, it } from 'vitest'
import bootstrap from '../../public/account-proof-init.js?raw'

function open(pathname: string, hash: string, search = '') {
  const events: string[] = []
  const listeners: Record<string, () => void> = {}
  const notices: string[] = []
  const location = { pathname, hash, search }
  const browser = { addEventListener: (event: string, listener: () => void) => { listeners[event] = listener },
    dispatchEvent: (event: Event) => { notices.push(event.type) } }
  const history = { replaceState: (state: unknown, _title: string, url: string) => {
    expect(state).toBeNull()
    events.push(url)
    location.hash = ''
    location.search = ''
  } }

  new Function('window', 'location', 'history', bootstrap)(browser, location, history)

  return { events, listeners, location, notices, take: () => (browser as typeof browser & {
    __takeAccountProof: () => { kind: string; proof: string; expiresAt: number } | null
  }).__takeAccountProof() }
}

describe('first party proof bootstrap', () => {
  const proof = 'A'.repeat(43)

  it.each(['/verify-email', '/VERIFY-EMAIL/', '/verify-%65mail', '/reset-password'])('scrubs before transferring a proof once: %s', pathname => {
    const result = open(pathname, '#proof=' + proof)
    const kind = pathname === '/reset-password' ? 'reset' : 'verify'

    expect(result.events).toEqual([kind === 'reset' ? '/reset-password' : '/verify-email'])
    expect(result.take()).toMatchObject({ kind, proof })
    expect(result.take()).toBeNull()
  })

  it.each(['', '#proof=', '#proof=' + 'A'.repeat(44), '#proof=' + 'B'.repeat(43), '#proof=' + proof + '&proof=' + proof,
    '#proof=%41' + 'A'.repeat(42), '#other=' + proof, '#proof=' + 'A'.repeat(9000)])('scrubs invalid input without retaining it', fragment => {
    const result = open('/verify-email', fragment)

    expect(result.events).toEqual(['/verify-email'])
    expect(result.take()).toBeNull()
  })

  it('rejects query-bearing links and non-action aliases', () => {
    expect(open('/verify-email', '#proof=' + proof, '?proof=' + proof).take()).toBeNull()

    for (const path of ['/signup', '/verify-email%2f', '/%2fverify-email', '/verify-email/extra']) {
      expect(open(path, '#proof=' + proof).take()).toBeNull()
    }
  })

  it('scrubs misplaced proof data without accepting it or changing unrelated fragment navigation', () => {
    const misplaced = open('/signup', '#proof=' + proof)

    expect(misplaced.events).toEqual(['/signup'])
    expect(misplaced.take()).toBeNull()
    expect(open('/products', '#editor').events).toEqual([])
    expect(open('/login', '', '?proof=' + proof).events).toEqual(['/login'])
  })

  it('discards proof before a frozen document can restore it', () => {
    const result = open('/reset-password', '#proof=' + proof)
    result.listeners.pagehide()

    expect(result.take()).toBeNull()
  })

  it('captures a reopened same-document link before later navigation listeners without repeating the handoff', () => {
    const result = open('/verify-email', '')
    result.location.hash = '#proof=' + proof
    result.listeners.popstate()

    expect(result.location.hash).toBe('')
    expect(result.take()).toMatchObject({ kind: 'verify', proof })
    expect(result.notices).toEqual(['account:proof-entry'])
    result.listeners.hashchange()
    expect(result.take()).toBeNull()
    expect(result.notices).toHaveLength(1)
    result.location.hash = '#proof=' + proof + '&proof=' + proof
    result.listeners.hashchange()
    expect(result.location.hash).toBe('')
    expect(result.take()).toBeNull()
    expect(result.notices).toHaveLength(2)
    const superseded = open('/verify-email', '#proof=' + proof)
    superseded.location.hash = '#proof=invalid'
    superseded.listeners.popstate()
    expect(superseded.take()).toBeNull()
  })
})
