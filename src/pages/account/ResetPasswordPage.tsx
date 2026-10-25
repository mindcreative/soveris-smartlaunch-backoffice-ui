import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AccountLayout } from '../../account/AccountLayout'
import { PasswordField } from '../../account/PasswordField'
import { AccountFeedback } from '../../account/AccountFeedback'
import { newPasswordError } from '../../account/credentials'
import { accountFlow } from '../../account/accountFlow'
import { accountLifecycleApi } from '../../account/accountLifecycleApi'
import { useAccountAction, useAccountClock } from '../../account/useAccountAction'
import { ACCOUNT_BUTTON_CLASS, ACCOUNT_LINK_CLASS } from '../../account/constants/accountLifecycle'

export default function ResetPasswordPage() {
  const action = useAccountAction()
  const now = useAccountClock()
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [complete, setComplete] = useState(false)
  const proof = accountFlow.proof('reset')

  useEffect(() => {
    if (!proof) {
      setPassword('')
    }
  }, [proof])

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const proof = accountFlow.proof('reset')
    const invalidPassword = newPasswordError(password)
    setPasswordError(invalidPassword)

    if (!proof || invalidPassword) {
      event.currentTarget.querySelector<HTMLInputElement>('#password')?.focus()

      return
    }

    void action.run(async operation => {
      await accountLifecycleApi.reset({ proof, newPassword: password }, operation.signal)

      if (!operation.isCurrent()) {
        return
      }

      accountFlow.clear()
      setPassword('')
      setComplete(true)
    }, () => setPassword(''))
  }

  return <AccountLayout title={complete ? 'Password reset' : 'Reset your password'}>
    {complete ? <p role="status" className="text-sm">Your password was reset. Log in normally using the new password. This action does not sign you in or change multi-factor requirements.</p>
      : !proof ? <p role="status" className="text-sm">Reopen your recovery email or request a fresh link. Reloading or leaving this page clears its proof.</p>
        : <form noValidate onSubmit={submit} className="space-y-4" aria-busy={action.pending}>
          <p className="text-sm text-muted">Opening this link does not reset a password. Submit a new password to continue.</p>
          <AccountFeedback error={action.error} pending={action.pending} />
          <PasswordField label="New password" value={password} onChange={setPassword} newPassword error={passwordError} />
          <button type="submit" className={ACCOUNT_BUTTON_CLASS} disabled={action.pending || now < action.retryAt}>Reset password</button>
        </form>}
    {!complete && <Link to="/forgot-password" onClick={() => accountFlow.clear()} className={ACCOUNT_LINK_CLASS}>Request a fresh recovery link</Link>}
  </AccountLayout>
}
