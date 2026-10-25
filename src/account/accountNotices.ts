export function accountNoticeUrl(value: string | undefined, mode?: string): string | null {
  if (!value || value.length > 2048 || /[\\\u0000-\u0020\u007f]/.test(value)) {
    return null
  }

  try {
    const url = new URL(value)
    const loopbackFixture = mode === 'local-fixture' && url.origin === 'http://127.0.0.1:5173' &&
      ['/fixtures/account-terms.html', '/fixtures/account-privacy.html'].includes(url.pathname) && !url.search && !url.hash

    if (url.username || url.password || (url.protocol !== 'https:' && !loopbackFixture)) {
      return null
    }

    return url.href
  } catch {
    return null
  }
}
