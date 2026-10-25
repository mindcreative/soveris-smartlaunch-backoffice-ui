import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AccountLayout } from '../../account/AccountLayout'
import { AccountFeedback } from '../../account/AccountFeedback'
import { accountEmail } from '../../account/credentials'
import { accountFlow } from '../../account/accountFlow'
import { accountLifecycleApi } from '../../account/accountLifecycleApi'
import { useAccountAction, useAccountClock } from '../../account/useAccountAction'
import { ACCOUNT_BUTTON_CLASS, ACCOUNT_INPUT_CLASS, ACCOUNT_LIMITS, ACCOUNT_LINK_CLASS } from '../../account/constants/accountLifecycle'

export default function CheckEmailPage() {
  const action = useAccountAction()
  const now = useAccountClock()
  const pending = accountFlow.pending()
  const [correction, setCorrection] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [invalidPending, setInvalidPending] = useState(false)
  const available = pending && !invalidPending
  const remaining = Math.max(0, Math.ceil((Math.max(pending?.nextRequestAt ?? 0, action.retryAt) - now) / 1000))

  function request(kind: 'resend' | 'correct', form?: HTMLFormElement): void {
    const current = accountFlow.pending()
    const email = kind === 'correct' ? accountEmail(correction) : null

    if (kind === 'correct' && !email) {
      setEmailError('Enter a valid account email address.')
      form?.querySelector<HTMLInputElement>('#correct-email')?.focus()

      return
    }

    if (!current || remaining > 0) {
      return
    }

    setEmailError(null)
    void action.run(async operation => {
      if (kind === 'correct' && email) {
        await accountLifecycleApi.correctEmail({ pendingToken: current.pendingToken, email }, operation.signal)
      } else {
        await accountLifecycleApi.resend({ pendingToken: current.pendingToken }, operation.signal)
      }

      if (!operation.isCurrent()) {
        return
      }

      accountFlow.pacePending(ACCOUNT_LIMITS.resendPacingSeconds)
      setNotice(kind === 'correct'
        ? 'Correction requested. Check the requested address; this response does not confirm an address change or delivery. Use the newest applicable email.'
        : 'Another email requested. This response does not guarantee delivery. Use the newest applicable email.')
    }, error => {
      accountFlow.pacePending(error.retryAfterSeconds ?? ACCOUNT_LIMITS.resendPacingSeconds)

      if (error.status === 401) {
        accountFlow.clear()
        setInvalidPending(true)
      }
    })
  }

  return <AccountLayout title="Check your email">
    {available ? <>
      <p className="break-words text-sm">Requested destination: {pending.email}</p>
      <p className="text-sm text-muted">If eligible and within delivery limits, an email can arrive. This response does not guarantee delivery. Open the newest applicable link and deliberately verify your email.</p>
      <p className="text-sm text-muted">This signup request expires in at most {Math.max(1, Math.ceil((pending.expiresAt - now) / 60000))} minutes. Resend and correction do not extend its lifetime or change the original password.</p>
      <AccountFeedback error={action.error} pending={action.pending} />
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {remaining > 0 && <p className="text-sm text-muted">You can request another email in {remaining} seconds. Delivery limits still apply.</p>}
      <button type="button" disabled={action.pending || remaining > 0} className={ACCOUNT_BUTTON_CLASS} onClick={() => request('resend')}>Request another email</button>
      <form noValidate className="space-y-3" onSubmit={event => { event.preventDefault(); request('correct', event.currentTarget) }}>
        <label htmlFor="correct-email" className="block text-sm font-medium">Correct email address</label>
        <input id="correct-email" name="email" type="email" autoComplete="email" inputMode="email" value={correction}
          onChange={event => setCorrection(event.target.value)} className={ACCOUNT_INPUT_CLASS} required aria-invalid={!!emailError} aria-describedby={emailError ? 'correct-email-error' : undefined} />
        {emailError && <p id="correct-email-error" className="text-sm text-danger">{emailError}</p>}
        <button type="submit" disabled={action.pending || remaining > 0} className={ACCOUNT_BUTTON_CLASS}>Request email correction</button>
      </form>
    </> : <p role="status" className="text-sm">This signup request is expired or unavailable in this page. Reopen your email link and use your original signup password. Reload cannot recover the pending request.</p>}
    <p className="text-sm text-muted">A fresh signup is a separate capped attempt and might not send immediately. Requesting another email does not revalidate an old link.</p>
    <Link to="/signup" onClick={() => accountFlow.clear()} className={ACCOUNT_LINK_CLASS}>Start a fresh signup</Link>
  </AccountLayout>
}
