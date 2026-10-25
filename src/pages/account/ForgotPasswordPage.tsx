import { useState } from 'react'
import { AccountLayout } from '../../account/AccountLayout'
import { AccountFeedback } from '../../account/AccountFeedback'
import { accountEmail } from '../../account/credentials'
import { accountLifecycleApi } from '../../account/accountLifecycleApi'
import { useAccountAction, useAccountClock } from '../../account/useAccountAction'
import { ACCOUNT_BUTTON_CLASS, ACCOUNT_INPUT_CLASS } from '../../account/constants/accountLifecycle'

export default function ForgotPasswordPage() {
  const action = useAccountAction()
  const now = useAccountClock()
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [complete, setComplete] = useState(false)

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const canonical = accountEmail(email)
    setEmailError(canonical ? null : 'Enter a valid account email address.')

    if (!canonical) {
      event.currentTarget.querySelector<HTMLInputElement>('#email')?.focus()

      return
    }

    void action.run(async operation => {
      await accountLifecycleApi.forgot({ email: canonical }, operation.signal)

      if (operation.isCurrent()) {
        setEmail('')
        setComplete(true)
      }
    })
  }

  return <AccountLayout title={complete ? 'Check for reset instructions' : 'Forgot password?'}>
    {complete ? <p role="status" className="text-sm">If this account is eligible, reset instructions have been requested. Delivery limits may apply. Check your email and deliberately open the newest applicable link.</p>
      : <form noValidate onSubmit={submit} className="space-y-4" aria-busy={action.pending}>
        <p className="text-sm text-muted">Request instructions using your account email. This does not confirm that an account or a password exists.</p>
        <AccountFeedback error={action.error} pending={action.pending} />
        <div><label htmlFor="email" className="block text-sm font-medium">Email address</label>
          <input id="email" name="email" type="email" autoComplete="email" inputMode="email" required value={email}
            onChange={event => setEmail(event.target.value)} className={ACCOUNT_INPUT_CLASS} aria-invalid={!!emailError} aria-describedby={emailError ? 'email-error' : undefined} />
          {emailError && <p id="email-error" className="text-sm text-danger">{emailError}</p>}
        </div>
        <button type="submit" className={ACCOUNT_BUTTON_CLASS} disabled={action.pending || now < action.retryAt}>Request reset instructions</button>
      </form>}
  </AccountLayout>
}
