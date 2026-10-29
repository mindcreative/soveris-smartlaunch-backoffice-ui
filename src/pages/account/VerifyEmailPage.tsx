import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'
import { currentAuthorityEpoch } from '../../auth/authorityEpoch'
import { permittedLanding } from '../../auth/experience'
import { acceptedAccountSessionIsCurrent, firstProductHandoff } from '../../account/sessionHandoff'
import { GoogleAccountButton } from '../../account/GoogleAccountButton'
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
  const [method, setMethod] = useState<'email_password' | 'google' | null>(() => accountFlow.pending()?.authMethod ?? null)
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

    if (!proof || !method || (method === 'email_password' && usePassword && !password)) {
      event.currentTarget.querySelector<HTMLInputElement>('#password')?.focus()

      return
    }

    void action.run(async operation => {
      const result = await accountLifecycleApi.verify(method === 'email_password' && (usePassword || !pending)
        ? { proof, password } : { proof, pendingToken: pending!.pendingToken }, operation.signal)

      if (!operation.isCurrent()) {
        return
      }

      if (result.status === 'activated') {
        setPassword('')

        try {
          const accepted = await useAuthStore.getState().acceptActivationSession(result.session, currentAuthorityEpoch(), operation.signal)

          if (!accepted || !acceptedAccountSessionIsCurrent(result.session) || !operation.pageIsCurrent()) {
            return
          }

          const user = useAuthStore.getState().user
          firstProductHandoff.offer(result.nextAction)
          const firstProduct = result.nextAction === 'create_first_product' &&
            user?.permissions?.includes('products:view') && user.permissions.includes('products:create')
          accountFlow.clear()
          navigate(firstProduct ? '/products' : permittedLanding(user), { replace: true, state: null })
        } catch {
          if (!operation.pageIsCurrent() || useAuthStore.getState().accessToken) {
            return
          }

          try {
            if (localStorage.getItem('backoffice_access_token') || localStorage.getItem('backoffice_refresh_token')) {
              return
            }
          } catch {
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
      : !proof ? <p role="status" className="text-sm">Reopen the newest applicable email link. Reloading or leaving this page clears its proof. Follow the instructions for the sign-in method used at signup.</p>
        : !method ? <><p className="text-sm">Check which sign-in method this email proof belongs to before continuing. This does not activate your account.</p>
          <AccountFeedback error={action.error} pending={action.pending} />
          <button type="button" className={ACCOUNT_BUTTON_CLASS} disabled={action.pending || now < action.retryAt} onClick={() => void action.run(async operation => {
            const context = await accountLifecycleApi.proofContext(proof, operation.signal)

            if (operation.isCurrent()) {
              if (context.completed && context.authMethod === 'google') {
                finish()

                return
              }

              setMethod(context.authMethod)
            }
          })}>Check sign-in method</button></>
        : method === 'google' && accountFlow.pending()?.authMethod !== 'google' ? <>
          <p className="text-sm">Continue with the same Google identity that started this signup. The email link alone cannot activate the account.</p>
          <GoogleAccountButton intent="resume_verification" proof={proof} label="Verify and continue with Google" />
        </>
        : <form noValidate onSubmit={submit} className="space-y-4" aria-busy={action.pending}>
          <p className="text-sm text-muted">Opening this link does not activate your account. Choose Verify email to continue.</p>
          <AccountFeedback error={action.error} pending={action.pending} />
          {method === 'google' ? <p className="text-sm text-muted">Continue with the Google signup request held in this browser. No local password is created.</p>
            : usePassword ? <PasswordField label="Original signup password" value={password} onChange={setPassword} />
            : <><p className="text-sm text-muted">Continue with the signup request held in this page. If it does not match this email, use your original signup password.</p>
              <button type="button" onClick={() => setUsePassword(true)} className={ACCOUNT_LINK_CLASS}>Use original signup password</button></>}
          <button type="submit" disabled={action.pending || now < action.retryAt} className={ACCOUNT_BUTTON_CLASS}>Verify email</button>
        </form>}
  </AccountLayout>
}
