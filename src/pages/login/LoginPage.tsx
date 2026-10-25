import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { safeReturnPath } from '../../auth/experience'
import { useAuthStore } from '../../stores/authStore'
import { useAuth } from '../../hooks/useAuth'
import { AccountLayout } from '../../account/AccountLayout'
import { PasswordField } from '../../account/PasswordField'
import { useAccountClock } from '../../account/useAccountAction'
import { ACCOUNT_BUTTON_CLASS, ACCOUNT_INPUT_CLASS, ACCOUNT_LIMITS, ACCOUNT_LINK_CLASS } from '../../account/constants/accountLifecycle'
import type { ApiError } from '../../api/apiClient'

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login, logout, isAuthenticated, isInitialized, accessToken } = useAuth()
  const unavailable = useAuthStore(current => current.authorityUnavailable)
  const now = useAccountClock()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [retryAt, setRetryAt] = useState(0)
  const operation = useRef<AbortController | null>(null)
  const summary = useRef<HTMLDivElement>(null)
  const busy = useRef(false)
  const state = location.state as { from?: unknown; accountOutcome?: unknown } | null

  useEffect(() => () => operation.current?.abort(), [])

  useEffect(() => {
    const retire = () => setPassword('')
    const hide = () => {
      operation.current?.abort()
      flushSync(() => setPassword(''))
    }
    window.addEventListener('auth:retired', retire)
    window.addEventListener('pagehide', hide)

    return () => {
      window.removeEventListener('auth:retired', retire)
      window.removeEventListener('pagehide', hide)
    }
  }, [])

  useEffect(() => {
    if (error) {
      summary.current?.focus()
    }
  }, [error])

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    if (busy.current || Date.now() < retryAt) {
      return
    }

    if (!email || !password) {
      event.currentTarget.querySelector<HTMLInputElement>(email ? '#password' : '#email')?.focus()
      setError('Enter your email address and password.')

      return
    }

    busy.current = true
    setError('')
    setPending(true)
    const controller = new AbortController()
    operation.current = controller

    try {
      const accepted = await login(email, password, controller.signal)

      if (!accepted || controller.signal.aborted) {
        return
      }

      setPassword('')
      navigate(safeReturnPath(state?.from, useAuthStore.getState().user), { replace: true, state: null })
    } catch (failure) {
      if (controller.signal.aborted) {
        return
      }

      const status = failure && typeof failure === 'object' && 'status' in failure ? failure.status : undefined
      const retry = (failure as ApiError | undefined)?.retryAfterSeconds

      if (status === 429 && typeof retry === 'number' && Number.isSafeInteger(retry) && retry > 0 && retry <= ACCOUNT_LIMITS.maximumRetrySeconds) {
        setRetryAt(Date.now() + retry * 1000)
      }

      setPassword('')
      setError(status === 401 ? 'Login failed. Check your email and password.'
        : status === 429 ? 'Too many attempts. Wait before trying again.'
          : 'Login is temporarily unavailable. Try again later.')
    } finally {
      busy.current = false

      if (!controller.signal.aborted) {
        setPending(false)
      }
    }
  }

  if (!isInitialized) {
    return <AccountLayout title="Checking current session"><p role="status">Restoring access…</p></AccountLayout>
  }

  if (isAuthenticated || accessToken || unavailable) {
    return <AccountLayout title={isAuthenticated ? 'You are signed in' : 'Current session unavailable'} description="Sign out explicitly before logging in with another account.">
      <button type="button" className={ACCOUNT_BUTTON_CLASS} onClick={() => void logout()}>Sign out to continue</button>
    </AccountLayout>
  }

  return <AccountLayout title="Log in" description="Sign in to manage your workspace.">
    {state?.accountOutcome === 'activation_complete' && <p role="status" className="text-sm">Activation completed, but the session could not be established. Log in normally to continue.</p>}
    <form noValidate onSubmit={event => void submit(event)} className="space-y-4" aria-busy={pending}>
      {error && <div id="login-error" ref={summary} role="alert" tabIndex={-1} className="rounded-lg border border-danger-line bg-danger-soft p-3 text-sm text-danger">{error}</div>}
      <div><label htmlFor="email" className="block text-sm font-medium">Email address</label>
        <input id="email" name="email" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false}
          required value={email} onChange={event => setEmail(event.target.value)} aria-invalid={!!error} aria-describedby={error ? 'login-error' : undefined} className={ACCOUNT_INPUT_CLASS} />
      </div>
      <PasswordField value={password} onChange={setPassword} errorSummaryId={error ? 'login-error' : undefined} />
      <Link to="/forgot-password" className={ACCOUNT_LINK_CLASS}>Forgot password?</Link>
      {pending && <p role="status" className="text-sm text-muted">Signing in…</p>}
      {now < retryAt && <p role="status" className="text-sm text-muted">Wait at least {Math.ceil((retryAt - now) / 1000)} seconds before trying again.</p>}
      <button type="submit" disabled={pending || now < retryAt} className={`${ACCOUNT_BUTTON_CLASS} w-full`}>{pending ? 'Signing in…' : 'Sign in'}</button>
    </form>
  </AccountLayout>
}
