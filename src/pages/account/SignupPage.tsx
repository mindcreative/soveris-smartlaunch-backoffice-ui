import { useState } from 'react'
import { useTurnstileChallenge } from '../../account/useTurnstileChallenge'
import { TurnstileChallenge } from '../../account/TurnstileChallenge'
import { useNavigate } from 'react-router-dom'
import { AccountLayout } from '../../account/AccountLayout'
import { PasswordField } from '../../account/PasswordField'
import { AccountFeedback } from '../../account/AccountFeedback'
import { AccountNotices } from '../../account/AccountNotices'
import { GoogleAccountButton, GoogleAccountSeparator } from '../../account/GoogleAccountButton'
import { accountEmail, newPasswordError } from '../../account/credentials'
import { accountFlow } from '../../account/accountFlow'
import { accountLifecycleApi } from '../../account/accountLifecycleApi'
import { useAccountAction, useAccountClock } from '../../account/useAccountAction'
import { ACCOUNT_BUTTON_CLASS, ACCOUNT_INPUT_CLASS } from '../../account/constants/accountLifecycle'

export default function SignupPage() {
  const navigate = useNavigate()
  const action = useAccountAction()
  const challenge = useTurnstileChallenge()
  const now = useAccountClock()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const canonical = accountEmail(email)
    const invalidPassword = newPasswordError(password)
    setEmailError(canonical ? null : 'Enter a valid account email address.')
    setPasswordError(invalidPassword)

    if (!canonical || invalidPassword) {
      event.currentTarget.querySelector<HTMLInputElement>(canonical ? '#password' : '#email')?.focus()

      return
    }

    void action.run(async operation => {
      const requestStartedAt = Date.now()
      const admission = challenge.consume()
      const receipt = await accountLifecycleApi.register({ email: canonical, password, returnIntent: 'create_first_product',
        admissionContext: admission.contextId, turnstileToken: admission.token }, operation.signal, admission.csrf)

      if (!operation.isCurrent()) {
        return
      }

      setPassword('')
      // Starting at the request boundary keeps transport latency from extending
      // the server's absolute pending lifetime in this local UX projection.
      accountFlow.setPending(receipt, canonical, requestStartedAt)
      navigate('/check-email', { replace: true, state: null })
    })
  }

  return <AccountLayout title="Create account" description="Choose Google or an email and password. Your email must be verified before opening a workspace.">
    <AccountNotices />
    <TurnstileChallenge challenge={challenge} />
    <GoogleAccountButton intent="signup" disabled={action.pending || challenge.status !== 'ready'} admission={challenge.consume} />
    <GoogleAccountSeparator />
    <form noValidate onSubmit={submit} className="space-y-4" aria-busy={action.pending}>
      <AccountFeedback error={action.error} pending={action.pending} />
      <div><label htmlFor="email" className="block text-sm font-medium">Email address</label>
        <input id="email" name="email" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false}
          required value={email} onChange={event => setEmail(event.target.value)} aria-invalid={!!emailError}
          aria-describedby={emailError ? 'email-error' : undefined} className={ACCOUNT_INPUT_CLASS} />
        {emailError && <p id="email-error" className="mt-1 text-sm text-danger">{emailError}</p>}
      </div>
      <PasswordField value={password} onChange={setPassword} newPassword error={passwordError} />
      <button type="submit" disabled={action.pending || now < action.retryAt || challenge.status !== 'ready'} className={ACCOUNT_BUTTON_CLASS}>Create account</button>
    </form>
  </AccountLayout>
}
