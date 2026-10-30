import source from '../../challenge/challenge.js?raw'
import { expect, it, vi } from 'vitest'
import { CHALLENGE_MESSAGES } from './constants/turnstile'

it('keeps provider code in the child and refuses foreign, open or repeated initialization', () => {
  const messages: [unknown, string][] = []
  const listeners = new Map<string, (event: unknown) => void>()
  const scripts: Record<string, unknown>[] = []
  let options: Record<string, unknown> = {}
  const parent = { postMessage: (message: unknown, origin: string) => messages.push([message, origin]) }
  const window = { __accountChallenge: { parentOrigin: 'http://127.0.0.1:5173' },
    addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener), removeEventListener: vi.fn(),
    turnstile: { render: (_selector: string, value: Record<string, unknown>) => { options = value; return 'widget' }, remove: vi.fn() } }
  const document = { getElementById: () => ({ textContent: '' }), createElement: () => ({}), head: { appendChild: (script: Record<string, unknown>) => scripts.push(script) } }
  // Execute the exact child source with test-owned browser objects. This
  // harness is never imported by the shipping account bundle.
  new Function('window', 'parent', 'document', source)(window, parent, document)
  const initialize = listeners.get('message')!
  const payload = { type: CHALLENGE_MESSAGES.init, nonce: 'A'.repeat(43), siteKey: 'public-fixture' }
  initialize({ source: parent, origin: 'http://evil.test', data: payload })
  initialize({ source: window, origin: 'http://127.0.0.1:5173', data: payload })
  initialize({ source: parent, origin: 'http://127.0.0.1:5173', data: { ...payload, extra: 'forbidden' } })
  expect(scripts).toHaveLength(0)
  initialize({ source: parent, origin: 'http://127.0.0.1:5173', data: payload })
  initialize({ source: parent, origin: 'http://127.0.0.1:5173', data: payload })
  expect(scripts).toHaveLength(1)
  expect(scripts[0].src).toBe('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit')
  const load = scripts[0].onload as () => void
  load()
  expect(options).toMatchObject({ action: 'account_signup', cData: payload.nonce, retry: 'never', 'response-field': false })
  const complete = options.callback as (token: string) => void
  const expire = options['expired-callback'] as () => void
  complete('opaque-token')
  expire()
  expect(messages).toEqual([
    [{ type: CHALLENGE_MESSAGES.ready, nonce: payload.nonce }, 'http://127.0.0.1:5173'],
    [{ type: CHALLENGE_MESSAGES.success, nonce: payload.nonce, token: 'opaque-token' }, 'http://127.0.0.1:5173'],
  ])
  listeners.get('pagehide')!({})
  expect(window.turnstile.remove).toHaveBeenCalledWith('widget')
})
