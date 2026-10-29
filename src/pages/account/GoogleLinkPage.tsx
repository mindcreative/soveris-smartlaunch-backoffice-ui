import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AccountLayout } from '../../account/AccountLayout'
import { AccountFeedback } from '../../account/AccountFeedback'
import { PasswordField } from '../../account/PasswordField'
import { GoogleAccountButton } from '../../account/GoogleAccountButton'
import { googleAccountApi } from '../../account/googleAccountApi'
import { useAccountAction } from '../../account/useAccountAction'
import { ACCOUNT_BUTTON_CLASS, ACCOUNT_LINK_CLASS } from '../../account/constants/accountLifecycle'
import { useAuthStore } from '../../stores/authStore'

export default function GoogleLinkPage() {
  const current = useAuthStore()
  const action = useAccountAction()
  const [password, setPassword] = useState('')
  const proof = useRef<string | null>(null)
  const [proved, setProved] = useState(false)
  const [complete, setComplete] = useState(false)

  useEffect(() => {
    const clearProof = () => {
      proof.current = null
      setPassword('')
      setProved(false)
    }
    const retire = () => {
      clearProof()
      void googleAccountApi.cancel().catch(() => undefined)
    }
    window.addEventListener('auth:retired', retire)
    window.addEventListener('pagehide', clearProof)

    return () => {
      proof.current = null
      window.removeEventListener('auth:retired', retire)
      window.removeEventListener('pagehide', clearProof)
    }
  }, [])

  function prove(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()

    if (!password || !current.accessToken) {
      return
    }

    void action.run(async operation => {
      const value = await googleAccountApi.linkProof(password, current.accessToken!, operation.signal)

      if (operation.isCurrent()) {
        proof.current = value
        setPassword('')
        setProved(true)
      }
    }, () => setPassword(''))
  }

  function link(): void {
    const value = proof.current
    proof.current = null
    setProved(false)

    if (!value || !current.accessToken) {
      return
    }

    void action.run(async operation => {
      await googleAccountApi.link(value, current.accessToken!, operation.signal)

      if (!operation.isCurrent()) {
        return
      }

      setComplete(true)
      await useAuthStore.getState().logout()
    })
  }

  if (complete) {
    return <AccountLayout title="Google account linked"><p role="status">Start a fresh Google sign-in. Earlier sessions have been retired.</p><GoogleAccountButton intent="login" /></AccountLayout>
  }

  if (!current.isInitialized || current.isLoading) {
    return <AccountLayout title="Checking current session"><p role="status">Restoring access…</p></AccountLayout>
  }

  if (!current.isAuthenticated || !current.accessToken || current.authorityUnavailable) {
    return <AccountLayout title="Sign in before linking"><p>Sign in to the existing account with its password, then open this confirmation page. Google sign-in is not enough to link an existing account.</p>
      <Link to="/login" state={{ googleLink: true }} className={ACCOUNT_LINK_CLASS}>Sign in to the existing account</Link></AccountLayout>
  }

  return <AccountLayout title="Confirm Google linking" description="Link only the Google identity from the current attempt to this signed-in account. Your password and workspace stay the same.">
    <AccountFeedback error={action.error} pending={action.pending} />
    {proved ? <><p>Confirm that you want to link this Google identity. Linking retires current sessions and requires a fresh Google sign-in.</p>
      <button type="button" className={ACCOUNT_BUTTON_CLASS} disabled={action.pending} onClick={link}>Confirm and link Google</button></>
      : <form onSubmit={prove} className="space-y-4"><PasswordField label="Existing account password" value={password} onChange={setPassword} />
        <button type="submit" className={ACCOUNT_BUTTON_CLASS} disabled={action.pending}>Verify existing account</button></form>}
    <button type="button" className={ACCOUNT_LINK_CLASS} disabled={action.pending} onClick={() => void action.run(async operation => {
      await googleAccountApi.cancel(undefined, operation.signal)

      if (operation.isCurrent()) {
        proof.current = null
        setPassword('')
        setProved(false)
      }
    })}>Cancel linking</button>
  </AccountLayout>
}
