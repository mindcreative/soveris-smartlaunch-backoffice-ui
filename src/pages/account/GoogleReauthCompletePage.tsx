import { Link, useNavigate } from 'react-router-dom'
import { MfaLayout } from '../../account/MfaLayout'
import { mfaFlow } from '../../account/mfaFlow'
import { googleAccountApi } from '../../account/googleAccountApi'
import { useMfaAction } from '../../account/useMfaAction'
import { useAuthStore } from '../../stores/authStore'
import { MFA_ROUTES } from '../../account/constants/mfa'
import { ACCOUNT_BUTTON_CLASS, ACCOUNT_LINK_CLASS } from '../../account/constants/accountLifecycle'

export default function GoogleReauthCompletePage() {
  const navigate = useNavigate()
  const current = useAuthStore()
  const action = useMfaAction()

  return <MfaLayout title="Finish Google identity confirmation" action={action} description="This confirms the same Google identity for your current session. Google may reuse its existing sign-in; it does not verify your authenticator or a new Google password.">
    {current.isAuthenticated && current.accessToken ? <>
      <button type="button" disabled={action.pending} className={ACCOUNT_BUTTON_CLASS} onClick={() => void action.run(async operation => {
        const bound = await googleAccountApi.reauthenticationComplete(current.accessToken!, operation.signal)

        if (operation.isCurrent()) {
          mfaFlow.setPrimary(bound)
          mfaFlow.offerHandoff(MFA_ROUTES.security)
          navigate(MFA_ROUTES.security, { replace: true, state: null })
        }
      })}>Finish identity confirmation</button>
      <button type="button" disabled={action.pending} className={ACCOUNT_LINK_CLASS} onClick={() => void action.run(async operation => {
        await googleAccountApi.reauthenticationCancel(current.accessToken!, operation.signal)

        if (operation.isCurrent()) {
          mfaFlow.clear()
          navigate(MFA_ROUTES.security, { replace: true, state: null })
        }
      })}>Cancel Google confirmation</button>
    </> : <p role="status">Restore the original signed-in session to finish this confirmation. A different session cannot use this response.</p>}
    <Link to={MFA_ROUTES.security} className={ACCOUNT_LINK_CLASS}>Account security</Link>
  </MfaLayout>
}
