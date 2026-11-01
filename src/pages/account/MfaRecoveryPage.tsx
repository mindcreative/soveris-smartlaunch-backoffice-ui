import { refreshGoogleRecoveryPrimary } from '../../account/mfaRecoveryPopup'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { MfaLayout } from '../../account/MfaLayout'
import { PasswordField } from '../../account/PasswordField'
import { mfaApi } from '../../account/mfaApi'
import { mfaFlow } from '../../account/mfaFlow'
import { useMfaAction, useMfaPrivateInput, useMfaSnapshot } from '../../account/useMfaAction'
import { ACCOUNT_BUTTON_CLASS, ACCOUNT_INPUT_CLASS, ACCOUNT_LINK_CLASS } from '../../account/constants/accountLifecycle'
import { MFA_ROUTES } from '../../account/constants/mfa'
import { useAuthStore } from '../../stores/authStore'

export default function MfaRecoveryPage() {
  const navigate = useNavigate()
  const snapshot = useMfaSnapshot()
  const action = useMfaAction()
  const authenticated = useAuthStore(state => state.isAuthenticated)
  const [code, setCode] = useMfaPrivateInput()
  const [ticket, setTicket] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useMfaPrivateInput()

  function recover(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const candidate = code
    setCode('')
    void action.run(async operation => {
      if (!snapshot.login) {
        return
      }

      const continuation = await mfaApi.recover(snapshot.login, candidate, ticket, operation.signal)

      if (operation.isCurrent()) {
        mfaFlow.setRecovery(continuation)
      }
    })
  }

  return <MfaLayout title="Recover authenticator access" action={action} description="Recovery ends earlier sessions and permits only replacement enrollment. It does not sign you in or grant privileged access.">
    {authenticated ? <p>Sign out and start a fresh primary sign-in before lost-factor recovery.</p> : snapshot.recovery ? <>
      <p role="status">Recovery proof accepted. Complete replacement within this attempt’s original lifetime.</p>
      <button type="button" className={ACCOUNT_BUTTON_CLASS} disabled={action.pending} onClick={() => void action.run(async operation => {
        const enrollment = await mfaApi.recoveryEnrollment(snapshot.recovery!, snapshot.freshRecoveryPrimary, operation.signal)

        if (operation.isCurrent()) {
          mfaFlow.setEnrollment(enrollment)
          mfaFlow.offerHandoff(MFA_ROUTES.enroll)
          navigate(MFA_ROUTES.enroll, { state: null })
        }
      })}>Create replacement setup</button>
      <details><summary className={ACCOUNT_LINK_CLASS}>Refresh an aged primary proof without extending recovery</summary>
        <p className="text-sm">Confirm the same existing identity again if more than five minutes have passed. The original recovery deadline stays unchanged. Google opens a separate window; finish sign-in there explicitly, then return here.</p>
        <form noValidate className="space-y-4" onSubmit={event => { event.preventDefault(); const candidate = password; setPassword(''); void action.run(async operation => {
          const primary = await mfaApi.freshRecoveryPrimary({ email, password: candidate }, operation.signal)

          if (operation.isCurrent()) {
            mfaFlow.setFreshRecoveryPrimary(primary)
          }
        }) }}>
          <label className="block text-sm font-medium">Existing account email<input className={ACCOUNT_INPUT_CLASS} type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} /></label>
          <PasswordField value={password} onChange={setPassword} />
          <button className={ACCOUNT_BUTTON_CLASS} disabled={action.pending || !email || !password} type="submit">Refresh password primary proof</button>
        </form>
        <button type="button" className={ACCOUNT_BUTTON_CLASS} disabled={action.pending} onClick={() => void action.run(async operation => {
          const primary = await refreshGoogleRecoveryPrimary(operation, snapshot.recovery!.expiresAt)

          if (operation.isCurrent() && operation.pageIsCurrent()) {
            mfaFlow.setFreshRecoveryPrimary(primary)
          }
        })}>Refresh Google primary proof</button>
        {action.pending && <button type="button" className={ACCOUNT_LINK_CLASS} onClick={() => mfaFlow.cancel()}>Cancel identity confirmation</button>}
        {snapshot.freshRecoveryPrimary && <p role="status">A new primary proof is available. The original recovery deadline is unchanged.</p>}
      </details>
      <button type="button" className={ACCOUNT_LINK_CLASS} disabled={action.pending} onClick={() => void action.run(async operation => {
        await mfaApi.cancelRecovery(snapshot.recovery!, operation.signal)

        if (operation.isCurrent()) {
          mfaFlow.clear()
          navigate('/login', { replace: true, state: null })
        }
      })}>Cancel recovery</button>
    </> : snapshot.login ? <form noValidate className="space-y-4" onSubmit={recover}>
      <label className="flex min-h-11 items-start gap-3"><input type="checkbox" checked={ticket} onChange={event => { setTicket(event.target.checked); setCode('') }} />Use an individually approved recovery ticket</label>
      <label className="block text-sm font-medium">{ticket ? 'Recovery ticket' : 'Recovery code'}<input type="text" className={ACCOUNT_INPUT_CLASS} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={64} value={code} onChange={event => setCode(event.target.value)} aria-invalid={!!action.error} aria-describedby={action.error ? 'mfa-feedback' : undefined} /></label>
      <button type="submit" className={ACCOUNT_BUTTON_CLASS} disabled={action.pending || !code || Date.now() < action.retryAt}>Verify recovery proof</button>
      <button type="button" className={ACCOUNT_LINK_CLASS} disabled={action.pending} onClick={() => void action.run(async operation => {
        await mfaApi.cancelLogin(snapshot.login!, operation.signal)

        if (operation.isCurrent()) {
          mfaFlow.clear()
          navigate('/login', { replace: true, state: null })
        }
      })}>Cancel recovery</button>
    </form> : <p role="status">No current primary proof is available. Start a fresh sign-in. If recovery was already consumed or cancelled, request a new individually approved recovery ticket through your established recovery contact.</p>}
    <Link to="/login" className={ACCOUNT_LINK_CLASS}>Start fresh sign-in</Link>
  </MfaLayout>
}
