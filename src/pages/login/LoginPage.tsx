import { CircleAlert, LoaderCircle } from 'lucide-react'
import type { FC } from 'react'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { safeReturnPath } from '../../auth/experience'
import { useAuthStore } from '../../stores/authStore'
import { useAuth } from '@/hooks/useAuth'

const LoginPage: FC = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      await login(email, password)
      navigate(safeReturnPath((location.state as {from?:unknown} | null)?.from, useAuthStore.getState().user), { replace: true })
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'message' in err) {
        setError((err as { message: string }).message || 'Login failed. Please check your credentials.')
      } else {
        setError('Login failed. Please check your credentials.')
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-dvh bg-app flex items-center justify-center px-4 py-8 sm:px-6 lg:px-8">
      <div className="w-full max-w-sm">
        {/* Card */}
        <div className="bg-surface rounded-2xl shadow-sm border border-line overflow-hidden">
          {/* Header */}
          <div className="px-6 pt-8 text-center sm:px-8">
            <div className="mx-auto mb-4 w-36" role="img" aria-label="Soveris">
              <img src="/soveris-light.svg" alt="" className="brand-light h-auto w-full" />
              <img src="/soveris-dark.svg" alt="" className="brand-dark h-auto w-full" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">SmartLaunch</h1>
            <p className="mt-2 text-sm text-muted">Sign in to manage your workspace.</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="px-6 pb-8 pt-6 space-y-5 sm:px-8">
            {error && (
              <div role="alert" className="bg-danger-soft border border-danger-line rounded-lg px-4 py-3 flex items-start gap-3">
                <CircleAlert aria-hidden="true" className="w-5 h-5 text-danger shrink-0 mt-0.5" />
                <p className="text-sm text-danger">{error}</p>
              </div>
            )}

            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1.5">
                Email address
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="block w-full px-3.5 py-2.5 border border-control rounded-lg shadow-sm placeholder-muted text-foreground focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent text-sm"
                placeholder="you@example.com"
              />
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1.5">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="block w-full px-3.5 py-2.5 border border-control rounded-lg shadow-sm placeholder-muted text-foreground focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent text-sm"
                placeholder="••••••••"
              />
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex justify-center items-center px-4 py-3 bg-primary-solid hover:bg-primary-hover text-on-accent text-sm font-medium rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-focus focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? (
                <>
                  <LoaderCircle aria-hidden="true" className="animate-spin -ml-1 mr-2 h-4 w-4 text-on-accent" />
                  Signing in...
                </>
              ) : (
                'Sign in'
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="mt-6 text-center text-xs text-muted">
          &copy; {new Date().getFullYear()} Soveris SmartLaunch. All rights reserved.
        </p>
      </div>
    </div>
  )
}

export default LoginPage
