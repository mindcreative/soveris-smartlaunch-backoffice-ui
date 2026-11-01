import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { MfaLayout } from '../../account/MfaLayout'
import { TotpInput } from '../../account/TotpInput'
import { mfaApi } from '../../account/mfaApi'
import { mfaFlow } from '../../account/mfaFlow'
import { showMfaCodes } from '../../account/mfaCompletion'
import { useMfaAction, useMfaPrivateInput, useMfaSnapshot } from '../../account/useMfaAction'
import { ACCOUNT_BUTTON_CLASS, ACCOUNT_LINK_CLASS } from '../../account/constants/accountLifecycle'
import { MFA_ROUTES } from '../../account/constants/mfa'
import { useAuthStore } from '../../stores/authStore'
import { normalizeMfaError } from '../../account/mfaError'

export default function MfaEnrollPage() {
  const navigate = useNavigate()
  const snapshot = useMfaSnapshot()
  const action = useMfaAction()
  const authenticated = useAuthStore(state => state.isAuthenticated)
  const enrollment = snapshot.enrollment
  const [code, setCode] = useMfaPrivateInput()
  const [qr, setQr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)
  const imageUrl = useRef<string | null>(null)

  useEffect(() => {
    setSaved(false)
    setCopied(false)
  }, [snapshot.codes])

  useEffect(() => {
    if (!enrollment) {
      setQr(null)
      setCode('')

      return
    }

    let url: string | null = null

    try {
      const binary = atob(enrollment.qrPngBase64)
      const buffer = new ArrayBuffer(binary.length)
      const bytes = new Uint8Array(buffer)
      for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index)
      }

      const signature = [137, 80, 78, 71, 13, 10, 26, 10]

      if (!signature.every((value, index) => bytes[index] === value)) {
        throw new Error('Invalid local QR image')
      }

      url = URL.createObjectURL(new Blob([buffer], { type: 'image/png' }))
      imageUrl.current = url
      mfaFlow.registerDisclosureUrl(url)
      setQr(url)
    } catch {
      setQr(null)
    }

    return () => {
      if (url) {
        mfaFlow.releaseDisclosureUrl(url)
      }

      imageUrl.current = null
    }
  }, [enrollment?.enrollmentId])

  function confirm(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const candidate = code
    setCode('')

    void action.run(async operation => {
      if (!enrollment || !/^[0-9]{6}$/.test(candidate)) {
        throw normalizeMfaError({ code: 'invalid_mfa_flow' }, 400)
      }

      const codes = await mfaApi.confirm(enrollment, candidate, operation.signal)

      if (await showMfaCodes(codes, operation)) {
        navigate(MFA_ROUTES.enroll, { replace: true, state: null })
      }
    })
  }

  function cancel(): void {
    setCode('')
    void action.run(async operation => {
      if (enrollment) {
        await mfaApi.cancelEnrollment(enrollment, operation.signal)
      }

      if (operation.isCurrent()) {
        mfaFlow.clear()
        navigate(authenticated ? MFA_ROUTES.security : '/login', { replace: true, state: null })
      }
    })
  }

  if (snapshot.codes) {
    return <MfaLayout title="Save your recovery codes" action={action} description="This is the only display of this set. Save it privately, separately from your authenticator.">
      <ol aria-label="Recovery codes" className="space-y-2 break-all font-mono text-sm">{snapshot.codes.map(value => <li key={value}>{value}</li>)}</ol>
      <p className="text-sm text-muted">Clipboard history is outside this application. Copy only on a device you trust.</p>
      <button type="button" className={ACCOUNT_LINK_CLASS} onClick={() => { void navigator.clipboard.writeText(snapshot.codes!.join('\n')).then(() => setCopied(true)).catch(() => setCopied(false)) }}>Copy recovery codes</button>
      {copied && <p role="status">Recovery codes copied.</p>}
      <label className="flex min-h-11 items-start gap-3"><input type="checkbox" checked={saved} onChange={event => setSaved(event.target.checked)} />I saved these codes privately.</label>
      <button type="button" disabled={!saved} className={ACCOUNT_BUTTON_CLASS} onClick={() => { mfaFlow.clear(); navigate('/login', { replace: true, state: null }) }}>Continue to fresh sign-in</button>
    </MfaLayout>
  }

  return <MfaLayout title="Set up your authenticator" action={action} description="Scan the QR image or enter the manual key. Keep this page private.">
    {enrollment && (enrollment.recovery || authenticated) ? <>
      {qr ? <img src={qr} alt="Authenticator setup QR image; the equivalent manual key is below" className="mx-auto h-auto max-w-full" onLoad={() => {
        if (imageUrl.current) {
          mfaFlow.releaseDisclosureUrl(imageUrl.current)
          imageUrl.current = null
        }
      }} /> : <p role="status">Use the manual key below to set up your authenticator.</p>}
      <dl className="space-y-2 break-all text-sm"><dt className="font-semibold">Issuer</dt><dd>{enrollment.issuer}</dd><dt className="font-semibold">Account</dt><dd>{enrollment.accountLabel}</dd><dt className="font-semibold">Manual key</dt><dd className="select-all font-mono">{enrollment.manualKey}</dd></dl>
      <p className="text-sm">Choose time-based codes: SHA-1, six digits, every 30 seconds.</p>
      <p className="text-sm text-muted">Clipboard history is outside this application. Copy only on a device you trust.</p>
      <button type="button" className={ACCOUNT_LINK_CLASS} onClick={() => { void navigator.clipboard.writeText(enrollment.manualKey).then(() => setCopied(true)).catch(() => setCopied(false)) }}>Copy manual key</button>
      {copied && <p role="status">Manual key copied.</p>}
      <form noValidate onSubmit={confirm} className="space-y-4"><TotpInput value={code} onChange={setCode} invalid={!!action.error} disabled={action.pending} />
        <button type="submit" className={ACCOUNT_BUTTON_CLASS} disabled={action.pending || Date.now() < action.retryAt}>Confirm authenticator</button></form>
      <p className="text-sm text-muted">Confirmation retires current sessions. Save the new recovery codes, then sign in using the next authenticator code.</p>
      <button type="button" className={ACCOUNT_LINK_CLASS} disabled={action.pending} onClick={cancel}>Cancel enrollment</button>
    </> : <><p role="status">This setup is no longer available. Start again from account security or a fresh recovery attempt.</p><Link to={authenticated ? MFA_ROUTES.security : '/login'} className={ACCOUNT_LINK_CLASS}>{authenticated ? 'Account security' : 'Log in'}</Link></>}
  </MfaLayout>
}
