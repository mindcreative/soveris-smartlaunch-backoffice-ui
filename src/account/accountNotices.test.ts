import { expect, it } from 'vitest'
import { accountNoticeUrl } from './accountNotices'

it('validates configured document destinations without implying approval or inventing defaults', () => {
  expect(accountNoticeUrl('https://legal.example.test/account/terms')).toBe('https://legal.example.test/account/terms')

  for (const value of [undefined, '', '//legal.example.test', 'javascript:alert(1)', 'data:text/html,terms',
    'http://legal.example.test/terms', 'https://user:pass@legal.example.test/terms', 'https://legal.example.test\\evil']) {
    expect(accountNoticeUrl(value)).toBeNull()
  }

  expect(accountNoticeUrl('http://127.0.0.1:5173/fixtures/account-terms.html', 'local-fixture'))
    .toBe('http://127.0.0.1:5173/fixtures/account-terms.html')
  expect(accountNoticeUrl('http://127.0.0.1:5174/terms', 'local-fixture')).toBeNull()
})
