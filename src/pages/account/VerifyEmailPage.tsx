import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'
import { currentAuthorityEpoch } from '../../auth/authorityEpoch'
import { permittedLanding } from '../../auth/experience'
import { firstProductHandoff } from '../../account/sessionHandoff'
import { AccountLayout } from '../../account/AccountLayout'
import { PasswordField } from '../../account/PasswordField'
import { AccountFeedback } from '../../account/AccountFeedback'
import { accountFlow } from '../../account/accountFlow'
import { accountLifecycleApi } from '../../account/accountLifecycleApi'
import { useAccountAction, useAccountClock } from '../../account/useAccountAction'
import { ACCOUNT_BUTTON_CLASS, ACCOUNT_LINK_CLASS } from '../../account/constants/accountLifecycle'

export default function VerifyEmailPage() {
  const navigate = useNavigate()
  const action = useAccountAction()
  const now = useAccountClock()
  const [password, setPassword] = useState('')
  const [usePassword, setUsePassword] = useState(() => !accountFlow.pending())
  const [complete, setComplete] = useState(false)
  const proof = accountFlow.proof('verify')

  useEffect(() => {
    if (!proof) {
      setPassword('')
    }
  }, [proof])

  function finish(): void {
    accountFlow.clear()
    setPassword('')
    setComplete(true)
  }

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const proof = accountFlow.proof('verify')
    const pending = accountFlow.pending()

    if (!proof || (usePassword && !password)) {
      event.currentTarget.querySelector<HTMLInputElement>('#password')?.focus()

      return
    }

    void action.run(async operation => {
      const result = await accountLifecycleApi.verify(usePassword || !pending ? { proof, password } : { proof, pendingToken: pending.pendingToken }, operation.signal)

      if (!operation.isCurrent()) {
        return
      }

      if (result.status === 'activated') {
        setPassword('')

        try {
          const accepted = await useAuthStore.getState().acceptActivationSession(result.session, currentAuthorityEpoch(), operation.signal)

          if (!accepted) {
            return
          }

          const user = useAuthStore.getState().user
          firstProductHandoff.offer(result.nextAction)
          const firstProduct = result.nextAction === 'create_first_product' &&
            user?.permissions?.includes('products:view') && user.permissions.includes('products:create')
          accountFlow.clear()
          navigate(firstProduct ? '/products' : permittedLanding(user), { replace: true, state: null })
        } catch {
          if (!operation.pageIsCurrent()) {
            return
          }

          accountFlow.clear()
          navigate('/login', { replace: true, state: { accountOutcome: 'activation_complete' } })
        }
      } else {
        finish()
      }
    }, error => {
      setPassword('')

      if (error.status === 503 && error.loginRequired === true) {
        finish()
      }
    })
  }

  return <AccountLayout title={complete ? 'Activation complete' : 'Verify your email'}>
    {complete ? <p role="status" className="text-sm">Your account is activated. Log in normally to continue if a session was not established.</p>
      : !proof ? <p role="status" className="text-sm">Reopen the newest applicable email link. Reloading or leaving this page clears its proof. You can continue with your original signup password.</p>
        : <form noValidate onSubmit={submit} className="space-y-4" aria-busy={action.pending}>
          <p className="text-sm text-muted">Opening this link does not activate your account. Choose Verify email to continue.</p>
          <AccountFeedback error={action.error} pending={action.pending} />
          {usePassword ? <PasswordField label="Original signup password" value={password} onChange={setPassword} />
            : <><p className="text-sm text-muted">Continue with the signup request held in this page. If it does not match this email, use your original signup password.</p>
              <button type="button" onClick={() => setUsePassword(true)} className={ACCOUNT_LINK_CLASS}>Use original signup password</button></>}
          <button type="submit" disabled={action.pending || now < action.retryAt} className={ACCOUNT_BUTTON_CLASS}>Verify email</button>
        </form>}
  </AccountLayout>
}
