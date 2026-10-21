import { matchRoutes } from 'react-router-dom'
import { expect, it } from 'vitest'
import bootstrap from '../../public/appearance-init.js?raw'

it.each(['/login', '/LOGIN/', '/log%69n', '/%6cogin', '/login%2F', '/%2Flogin', '/dashboard'])('prepaint uses the router Login boundary for %s', pathname => {
  for (const systemDark of [false, true]) {
    const root = { dataset: {} as Record<string, string>, style: {} as Record<string, string> }
    const override = systemDark ? 'light' : 'dark'
    const token = 'e30.' + btoa(JSON.stringify({sub:'01990000-0000-7000-8000-000000000001',exp:4102444800})).replace(/=+$/, '') + '.c2ln'
    const initialize = new Function('location', 'document', 'window', 'localStorage', bootstrap)
    initialize({ pathname }, { documentElement: root }, { matchMedia: () => ({ matches: systemDark }) }, {
      getItem: (key: string) => key === 'backoffice-auth-persist'
        ? JSON.stringify({ version: 2, state: { accessToken: token, refreshTokenValue:'refresh' } })
        : key === 'backoffice_access_token' ? token : key === 'backoffice_refresh_token' ? 'refresh' : override,
    })
    const isLogin = !!matchRoutes([{ path: '/login' }], pathname)
    const expected = isLogin ? systemDark ? 'dark' : 'light' : override
    expect(root.dataset.theme).toBe(expected)
    expect(root.style.colorScheme).toBe(expected)
  }
})
