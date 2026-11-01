import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { MfaLayout } from '../../account/MfaLayout'
import { TotpInput } from '../../account/TotpInput'
import { mfaApi } from '../../account/mfaApi'
import { mfaFlow } from '../../account/mfaFlow'
import { useMfaAction, useMfaPrivateInput, useMfaSnapshot } from '../../account/useMfaAction'
import { ACCOUNT_BUTTON_CLASS, ACCOUNT_LINK_CLASS } from '../../account/constants/accountLifecycle'
import { MFA_ROUTES } from '../../account/constants/mfa'
import { GOOGLE_ACCOUNT } from '../../account/constants/googleAccount'
import { currentAuthorityEpoch } from '../../auth/authorityEpoch'
import { safeReturnPath } from '../../auth/experience'
import { acceptedAccountSessionIsCurrent } from '../../account/sessionHandoff'
import { useAuthStore } from '../../stores/authStore'
import { normalizeMfaError } from '../../account/mfaError'

export default function MfaChallengePage() {
  const navigate = useNavigate()
  const snapshot = useMfaSnapshot()
  const action = useMfaAction()
  const authenticated = useAuthStore(state => state.isAuthenticated)
  const bound = authenticated ? snapshot.stepUp : snapshot.login
  const [code, setCode] = useMfaPrivateInput()
  const [complete, setComplete] = useState(false)
  useEffect(() => setCode(''), [bound?.challenge.id])

  function verify(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const candidate = code
    setCode('')

    void action.run(async operation => {
      if (!bound || bound.challenge.attemptsRemaining <= 0 || !/^[0-9]{6}$/.test(candidate)) {
        throw normalizeMfaError({ code: 'invalid_mfa_flow' }, 400)
      }

      const destination = snapshot.returnPath
      const link = snapshot.linkAfterLogin

      if (authenticated) {
        await verifyCode(() => mfaApi.verifyChallenge(bound, candidate, operation.signal), bound.challenge.id, operation.isCurrent)

        if (!operation.isCurrent()) {
          return
        }

        await useAuthStore.getState().revalidateAuthority()

        if (operation.isCurrent()) {
          window.dispatchEvent(new CustomEvent('mfa:invalidate-peers'))
          setComplete(true)
          const target = destination === GOOGLE_ACCOUNT.linkPath ? destination : MFA_ROUTES.security
          mfaFlow.offerHandoff(target)
          navigate(target, { replace: true, state: null })
        }
      } else {
        const session = await verifyCode(() => mfaApi.verifyLogin(bound, candidate, operation.signal), bound.challenge.id, operation.isCurrent)

        if (!operation.isCurrent()) {
          return
        }

        const accepted = await useAuthStore.getState().acceptActivationSession(session, currentAuthorityEpoch(), operation.signal)

        if (accepted && acceptedAccountSessionIsCurrent(session) && operation.pageIsCurrent()) {
          navigate(link ? GOOGLE_ACCOUNT.linkPath : safeReturnPath(destination, useAuthStore.getState().user), { replace: true, state: null })
        }
      }
    })
  }

  function cancel(): void {
    const original = bound
    setCode('')

    void action.run(async operation => {
      if (original) {
        if (authenticated) {
          await mfaApi.cancelChallenge(original, operation.signal)
        } else {
          await mfaApi.cancelLogin(original, operation.signal)
        }
      }

      if (operation.isCurrent()) {
        if (authenticated) {
          mfaFlow.clearStepUp()
          mfaFlow.offerHandoff(MFA_ROUTES.security)
        } else {
          mfaFlow.clear()
        }

        navigate(authenticated ? MFA_ROUTES.security : '/login', { replace: true, state: null })
      }
    })
  }

  return <MfaLayout title={authenticated ? 'Verify authenticator' : 'Finish sign-in'} action={action}
    description="Use your authenticator app. Verification grants only the access already assigned to your account.">
    {complete && <p role="status">Authenticator verified.</p>}
    {bound ? <>
      <form noValidate onSubmit={verify} className="space-y-4" aria-busy={action.pending}>
        <TotpInput value={code} onChange={setCode} invalid={!!action.error} disabled={action.pending} />
        <p className="text-sm text-muted">If a code was just used for setup or another request, wait for the next code.</p>
        <button type="submit" className={ACCOUNT_BUTTON_CLASS} disabled={action.pending || bound.challenge.attemptsRemaining <= 0 || Date.now() < action.retryAt}>Verify code</button>
        {bound.challenge.attemptsRemaining <= 0 && <p role="status">This attempt has no retries left. Cancel verification and start a fresh attempt.</p>}
      </form>
      {!authenticated && <Link to={MFA_ROUTES.recover} onClick={() => mfaFlow.offerHandoff(MFA_ROUTES.recover)} className={ACCOUNT_LINK_CLASS}>Use a recovery code or approved recovery ticket</Link>}
    </> : <p role="status">This security attempt is no longer available. Start a fresh sign-in or open account security.</p>}
    <button type="button" className={ACCOUNT_LINK_CLASS} disabled={action.pending} onClick={cancel}>Cancel verification</button>
    {!bound && <Link to={authenticated ? MFA_ROUTES.security : '/login'} className={ACCOUNT_LINK_CLASS}>{authenticated ? 'Account security' : 'Start fresh sign-in'}</Link>}
  </MfaLayout>
}

async function verifyCode<TResult>(request: () => Promise<TResult>, id: string, isCurrent: () => boolean): Promise<TResult> {
  try {
    return await request()
  } catch (failure) {
    if (isCurrent() && failure && typeof failure === 'object' && 'status' in failure && failure.status === 400) {
      mfaFlow.rejectChallenge(id)
    }

    throw failure
  }
}
