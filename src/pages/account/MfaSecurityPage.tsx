import { useEffect, useLayoutEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { MfaLayout } from '../../account/MfaLayout'
import { PasswordField } from '../../account/PasswordField'
import { mfaApi } from '../../account/mfaApi'
import { mfaFlow } from '../../account/mfaFlow'
import { googleAccountApi } from '../../account/googleAccountApi'
import { showMfaCodes } from '../../account/mfaCompletion'
import { useMfaAction, useMfaPrivateInput, useMfaSnapshot } from '../../account/useMfaAction'
import { hasFreshMfa } from '../../auth/mfaAuthority'
import { useAuthStore } from '../../stores/authStore'
import { ACCOUNT_BUTTON_CLASS, ACCOUNT_INPUT_CLASS, ACCOUNT_LINK_CLASS } from '../../account/constants/accountLifecycle'
import { MFA_ROUTES } from '../../account/constants/mfa'
import type { MfaPrimaryPurpose, MfaSecurityStatus } from '../../account/models/mfa'

export default function MfaSecurityPage() {
  const navigate = useNavigate()
  const current = useAuthStore()
  const snapshot = useMfaSnapshot()
  const action = useMfaAction()
  const [status, setStatus] = useState<MfaSecurityStatus | null>(null)
  const [password, setPassword] = useMfaPrivateInput()
  const [purpose, setPurpose] = useState<MfaPrimaryPurpose>('enrollment')
  const [removeConfirmed, setRemoveConfirmed] = useState(false)
  const primary = snapshot.primary
  const fresh = hasFreshMfa(current.user)

  useLayoutEffect(() => {
    setStatus(null)
    setPassword('')
    setRemoveConfirmed(false)
  }, [current.user?.sessionId, current.user?.securityRevision])

  useEffect(() => {
    const retireConfirmation = () => setRemoveConfirmed(false)
    window.addEventListener('auth:retired', retireConfirmation)
    window.addEventListener('auth:privileged-retired', retireConfirmation)
    window.addEventListener('pagehide', retireConfirmation)

    return () => {
      window.removeEventListener('auth:retired', retireConfirmation)
      window.removeEventListener('auth:privileged-retired', retireConfirmation)
      window.removeEventListener('pagehide', retireConfirmation)
    }
  }, [])

  useEffect(() => {
    if (current.isAuthenticated) {
      void action.run(async operation => {
        const result = await mfaApi.status(operation.signal)

        if (operation.isCurrent()) {
          setStatus(result)
          const boundPurpose = snapshot.primary?.challenge.purpose
          setPurpose(boundPurpose === 'factor_change' || boundPurpose === 'replacement' || boundPurpose === 'enrollment'
            ? boundPurpose : result.mfaState === 'enrolled' ? 'replacement' : 'enrollment')
        }
      })
    }
  }, [current.isAuthenticated, current.user?.sessionId, current.user?.securityRevision])

  function prove(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const candidate = password
    setPassword('')

    void action.run(async operation => {
      const bound = await mfaApi.password(candidate, purpose, operation.signal, primary?.csrfToken)

      if (operation.isCurrent()) {
        mfaFlow.setPrimary(bound)
      }
    })
  }

  function stepUp(): void {
    void action.run(async operation => {
      const bound = await mfaApi.startChallenge(primary ? 'factor_change' : 'step_up', operation.signal, primary?.csrfToken)

      if (operation.isCurrent()) {
        mfaFlow.setStepUp(bound)
        mfaFlow.offerHandoff(MFA_ROUTES.challenge)
        navigate(MFA_ROUTES.challenge, { state: null })
      }
    })
  }

  function startEnrollment(): void {
    void action.run(async operation => {
      if (!primary) {
        return
      }

      const enrollment = await mfaApi.startEnrollment(primary, operation.signal)

      if (operation.isCurrent()) {
        mfaFlow.setEnrollment(enrollment)
        mfaFlow.offerHandoff(MFA_ROUTES.enroll)
        navigate(MFA_ROUTES.enroll, { state: null })
      }
    })
  }

  function changeFactor(remove: boolean): void {
    void action.run(async operation => {
      if (!primary || remove && !removeConfirmed) {
        return
      }

      const codes = await mfaApi.changeFactor(primary, remove, operation.signal)

      if (codes) {
        if (await showMfaCodes(codes, operation)) {
          navigate(MFA_ROUTES.enroll, { replace: true, state: null })
        }
      } else if (operation.isCurrent()) {
        await useAuthStore.getState().clearSession()

        if (operation.pageIsCurrent()) {
          navigate('/login', { replace: true, state: null })
        }
      }
    })
  }

  if (!current.isInitialized || current.isLoading) {
    return <MfaLayout title="Checking account security"><p role="status">Verifying current access…</p></MfaLayout>
  }

  if (!current.isAuthenticated || current.authorityUnavailable) {
    return <MfaLayout title="Verify your current session"><p>Sign in to manage your own security settings.</p><Link to="/login" className={ACCOUNT_LINK_CLASS}>Log in</Link></MfaLayout>
  }

  return <MfaLayout title="Account security" action={action} description="Authenticator protection is voluntary for customer work and mandatory for privileged access. It never adds permissions.">
    {status ? <>
      <p role="status">{status.mfaState === 'enrolled' ? 'Authenticator enabled.' : status.mfaState === 'recovery-required' ? 'Controlled re-enrollment is required.' : 'No authenticator is enrolled.'}</p>
      {status.mandatoryForPrivilege && <p>Privileged operations require an enrolled authenticator and current verification.</p>}
      {status.mfaState === 'enrolled' && <button type="button" onClick={stepUp} disabled={action.pending} className={ACCOUNT_BUTTON_CLASS}>Verify authenticator for privileged access</button>}
      {status.mfaState !== 'recovery-required' && <>
        <label className="block text-sm font-medium">Security action<select value={purpose} className={ACCOUNT_INPUT_CLASS} onChange={event => { mfaFlow.clear(); setPurpose(event.target.value as MfaPrimaryPurpose); setPassword(''); setRemoveConfirmed(false) }}>
          <option value={status.mfaState === 'enrolled' ? 'replacement' : 'enrollment'}>{status.mfaState === 'enrolled' ? 'Replace authenticator' : 'Enable authenticator'}</option>
          {status.mfaState === 'enrolled' && <option value="factor_change">Regenerate codes or remove authenticator</option>}
        </select></label>
        {status.hasLocalPassword && <form noValidate onSubmit={prove} className="space-y-4"><PasswordField label="Current account password" value={password} onChange={setPassword} errorSummaryId={action.error ? 'mfa-feedback' : undefined} />
          <button type="submit" disabled={action.pending || !password} className={ACCOUNT_BUTTON_CLASS}>Verify primary identity</button></form>}
        {status.googleReauthenticationAvailable && <button type="button" disabled={action.pending} className={ACCOUNT_LINK_CLASS} onClick={() => void action.run(async operation => {
          if (!current.accessToken) {
            return
          }

          const start = await googleAccountApi.reauthenticationStart(purpose, current.accessToken, operation.signal)

          if (operation.isCurrent()) {
            mfaFlow.clear()
            window.location.assign(start.authorizationUrl)
          }
        })}>Confirm this identity with Google</button>}
        {primary && <>
          <p role="status">Primary identity verified for this security action.</p>
          {status.mfaState === 'enrolled' && !fresh ? <button type="button" disabled={action.pending} className={ACCOUNT_BUTTON_CLASS} onClick={stepUp}>Verify current authenticator before changing it</button>
            : primary.challenge.purpose === 'enrollment' || primary.challenge.purpose === 'replacement' ? <button type="button" disabled={action.pending} className={ACCOUNT_BUTTON_CLASS} onClick={startEnrollment}>Create authenticator setup</button>
              : <>
                <button type="button" disabled={action.pending} className={ACCOUNT_BUTTON_CLASS} onClick={() => changeFactor(false)}>Regenerate recovery codes</button>
                {status.mandatoryForPrivilege ? <p>Authenticator removal is unavailable while privileged assignments remain.</p> : <>
                  <label className="flex min-h-11 items-start gap-3"><input type="checkbox" checked={removeConfirmed} onChange={event => setRemoveConfirmed(event.target.checked)} />I confirm removal and understand that all current sessions will end.</label>
                  <button type="button" disabled={action.pending || !removeConfirmed} className={ACCOUNT_LINK_CLASS} onClick={() => changeFactor(true)}>Remove authenticator</button>
                </>}
              </>}
        </>}
      </>}
      <p className="text-sm">Lost your factor? Sign out, start a fresh sign-in with your existing primary identity, then choose recovery. A recovery code or an individually approved recovery ticket permits replacement only.</p>
      <button type="button" className={ACCOUNT_LINK_CLASS} onClick={() => { void current.logout().then(() => navigate('/login', { state: null })) }}>Sign out for lost-factor recovery</button>
    </> : <><p role="status">Security settings are not yet available.</p><button type="button" className={ACCOUNT_LINK_CLASS} disabled={action.pending} onClick={() => void action.run(async operation => {
      const result = await mfaApi.status(operation.signal)

      if (operation.isCurrent()) {
        setStatus(result)
      }
    })}>Retry security status</button></>}
  </MfaLayout>
}
