import { accountFlow } from './accountFlow'
import { googleAccountApi } from './googleAccountApi'
import { useAccountAction, useAccountClock } from './useAccountAction'
import { AccountFeedback } from './AccountFeedback'
import type { SignupChallengeAdmission } from './models/turnstile'
import type { GoogleIntent } from './models/googleAccount'

export function GoogleAccountButton({ intent, proof, label = 'Continue with Google', disabled = false, admission }: {
  intent: GoogleIntent
  proof?: string
  label?: string
  disabled?: boolean
  admission?: () => SignupChallengeAdmission
}) {
  const action = useAccountAction()
  const now = useAccountClock()

  function start(): void {
    void action.run(async operation => {
      const signup = intent === 'signup' ? admission?.() : undefined
      const response = signup ? await googleAccountApi.start(intent, proof, operation.signal, signup)
        : await googleAccountApi.start(intent, proof, operation.signal)

      if (!operation.isCurrent()) {
        return
      }

      accountFlow.clear()
      window.location.assign(response.authorizationUrl)
    })
  }

  return <div className="space-y-3">
    <button type="button" onClick={start} disabled={disabled || action.pending || now < action.retryAt}
      className="flex min-h-11 w-full items-center justify-center gap-3 rounded-md border border-control bg-surface px-3 py-2.5 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50">
      <span className="flex h-6 w-6 items-center justify-center rounded-sm bg-white"><img src="/google-g.png" width="20" height="20" alt="" /></span>
      {label}
    </button>
    <AccountFeedback error={action.error} pending={action.pending} />
  </div>
}

export function GoogleAccountSeparator() {
  return <div className="flex items-center gap-3 text-sm text-muted"><span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" /></div>
}
