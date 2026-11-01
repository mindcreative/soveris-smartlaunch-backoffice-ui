import { Link } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { permittedLanding } from '../auth/experience'
import { AccountLayout } from './AccountLayout'
import { AccountFeedback } from './AccountFeedback'
import { ACCOUNT_LINK_CLASS } from './constants/accountLifecycle'
import { mfaFlow } from './mfaFlow'
import { useMfaSnapshot } from './useMfaAction'
import { useAccountClock } from './useAccountAction'
import type { MfaLayoutProps } from './models/mfa'

export function MfaLayout({ title, description, action, children }: MfaLayoutProps) {
  useMfaSnapshot()
  const now = useAccountClock()
  const expiry = mfaFlow.nextExpiry()
  const user = useAuthStore(state => state.user)
  const authenticated = useAuthStore(state => state.isAuthenticated)

  return <AccountLayout title={title} description={description}>
    {authenticated && <Link to={permittedLanding(user)} className={ACCOUNT_LINK_CLASS}>Back to my workspace</Link>}
    <div id="mfa-feedback">{action && <AccountFeedback error={action.error} pending={action.pending} />}</div>
    {expiry !== null && <p className="text-sm text-muted" aria-live="off">This attempt expires in {Math.max(0, Math.ceil((expiry - now) / 1000))} seconds.</p>}
    {children}
  </AccountLayout>
}
