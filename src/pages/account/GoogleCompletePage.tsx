import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AccountLayout } from '../../account/AccountLayout'
import { AccountFeedback } from '../../account/AccountFeedback'
import { accountFlow } from '../../account/accountFlow'
import { googleAccountApi } from '../../account/googleAccountApi'
import { useAccountAction, useAccountClock } from '../../account/useAccountAction'
import { acceptedAccountSessionIsCurrent, firstProductHandoff } from '../../account/sessionHandoff'
import { ACCOUNT_BUTTON_CLASS, ACCOUNT_LINK_CLASS } from '../../account/constants/accountLifecycle'
import { GOOGLE_ACCOUNT } from '../../account/constants/googleAccount'
import { currentAuthorityEpoch } from '../../auth/authorityEpoch'
import { permittedLanding } from '../../auth/experience'
import { useAuthStore } from '../../stores/authStore'

export default function GoogleCompletePage() {
  const navigate = useNavigate()
  const action = useAccountAction()
  const now = useAccountClock()
  const [finished, setFinished] = useState(false)
  const [linkRequired, setLinkRequired] = useState(false)
  const [message, setMessage] = useState('Choose Finish sign-in to verify this Google response. Opening this page does not sign you in.')

  function complete(): void {
    void action.run(async operation => {
      setFinished(true)
      const requestStartedAt = Date.now()
      const result = await googleAccountApi.complete(operation.signal)

      if (!operation.isCurrent()) {
        return
      }

      if (result.status === 'authenticated' || result.status === 'activated') {
        const accepted = await useAuthStore.getState().acceptActivationSession(result.session, currentAuthorityEpoch(), operation.signal)

        if (!accepted || !acceptedAccountSessionIsCurrent(result.session) || !operation.pageIsCurrent()) {
          return
        }

        const user = useAuthStore.getState().user
        const firstProduct = result.status === 'activated' && user?.permissions?.includes('products:view') && user.permissions.includes('products:create')

        if (result.status === 'activated') {
          firstProductHandoff.offer(result.nextAction)
        }

        accountFlow.clear()
        navigate(firstProduct ? '/products' : permittedLanding(user), { replace: true, state: null })

        return
      }

      if (result.status === 'check_email') {
        accountFlow.setPending(result, '', requestStartedAt)
        navigate('/check-email', { replace: true, state: null })

        return
      }

      setFinished(true)

      if (result.status === 'link_required') {
        setLinkRequired(true)
        setMessage('Sign in to your existing account with its password, then explicitly open Google linking confirmation.')
      } else if (result.status === 'signup_required') {
        setMessage('This Google identity has no account here. Open Create account and choose Google after reading the registration notices.')
      } else if (result.status === 'login_required') {
        setMessage('Account activation may be complete. Start a fresh Google sign-in to establish a session.')
      } else {
        setMessage('Google sign-in was cancelled. You can start again from Log in or Create account.')
      }
    }, () => {
      setMessage('This attempt could not complete. Cancel and start a fresh Google sign-in from Log in or Create account.')
    })
  }

  function cancel(): void {
    void action.run(async operation => {
      await googleAccountApi.cancel(undefined, operation.signal)

      if (operation.isCurrent()) {
        accountFlow.clear()
        navigate('/login', { replace: true, state: null })
      }
    })
  }

  return <AccountLayout title="Finish Google sign-in">
    <p role="status" className="text-sm">{message}</p>
    <AccountFeedback error={action.error} pending={action.pending} />
    {!finished && <button type="button" className={ACCOUNT_BUTTON_CLASS} disabled={action.pending || now < action.retryAt} onClick={complete}>Finish sign-in</button>}
    {linkRequired && <Link to="/login" state={{ googleLink: true }} className={ACCOUNT_LINK_CLASS}>Sign in to the existing account</Link>}
    {linkRequired && <Link to={GOOGLE_ACCOUNT.linkPath} className={ACCOUNT_LINK_CLASS}>Open linking confirmation</Link>}
    <button type="button" className={ACCOUNT_LINK_CLASS} disabled={action.pending} onClick={cancel}>Cancel Google sign-in</button>
  </AccountLayout>
}
