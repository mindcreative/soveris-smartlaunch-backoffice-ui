import { useEffect, useRef, useState } from 'react'
import { TotpInput } from '../account/TotpInput'
import { MFA_TOTP_CODE } from '../account/constants/mfa'
import { mfaApi } from '../account/mfaApi'
import type { MfaBoundChallenge } from '../account/models/mfa'
import { createUuidV7 } from '../lib/uuidV7'
import { useAuthStore } from '../stores/authStore'
import { supportApi } from './client'
import { SUPPORT, SUPPORT_BUTTON_CLASS } from './constants'
import { SupportAccessError } from './errors'
import type { SupportMetadata } from './models'
import { executeSupportCommand, usePendingSupportCommand } from './pendingCommands'
import { useSupportAction, useSupportSnapshot } from './useSupportAction'

export function SupportActivation({ grant, refresh }: { grant: SupportMetadata; refresh: () => void }) {
  const action = useSupportAction()
  const { generation } = useSupportSnapshot()
  const pendingCommand = usePendingSupportCommand()
  const [bound, setBound] = useState<MfaBoundChallenge | null>(null)
  const [code, setCode] = useState('')
  const [proof, setProof] = useState<{ binding: string; deadline: number } | null>(null)
  const [message, setMessage] = useState('')
  const [invalid, setInvalid] = useState(false)
  const [now, setNow] = useState(performance.now())
  const outstanding = useRef<MfaBoundChallenge | null>(null)
  const actor = useRef(useAuthStore.getState().user)
  const startButton = useRef<HTMLButtonElement>(null)
  const activationFocused = useRef(false)
  const activateButton = useRef<HTMLButtonElement>(null)
  const form = useRef<HTMLFormElement>(null)
  const binding = JSON.stringify([generation, grant.id, grant.revision, grant.scopeHash])
  const verified = proof?.binding === binding && now < proof.deadline && performance.now() < proof.deadline

  useEffect(() => () => {
    const challenge = outstanding.current
    outstanding.current = null
    const current = useAuthStore.getState().user

    if (challenge && current?.id === actor.current?.id && current?.sessionId === actor.current?.sessionId && current?.securityRevision === actor.current?.securityRevision) {
      void mfaApi.cancelChallenge(challenge).catch(() => undefined)
    }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(performance.now()), 250)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    if (proof && !verified) {
      const focused = activationFocused.current
      setProof(null)
      setMessage('Verify this approved request again before activation. Check current request first.')

      if (focused) {
        window.setTimeout(() => startButton.current?.focus(), 0)
      }
    }
  }, [verified, proof])
  useEffect(() => {
    if (bound) {
      form.current?.querySelector<HTMLInputElement>('input')?.focus()
    } else if (verified) {
      activateButton.current?.focus()
    }
  }, [bound, verified])

  useEffect(() => {
    if (invalid && !action.pending) {
      form.current?.querySelector<HTMLInputElement>('input')?.focus()
    }
  }, [invalid, action.pending, message])

  useEffect(() => {
    if (bound && Date.now() >= Date.parse(bound.challenge.expiresAt)) {
      setBound(null)
      setCode('')
      setProof(null)
      setMessage('Challenge expired. Check current request, then start verification again.')
      window.setTimeout(() => startButton.current?.focus(), 0)
    }
  }, [bound, now])

  function start(): void {
    setProof(null)
    void action.run(async (signal, current) => {
      // Metadata must still be approved before issuing a renewal challenge.
      const detail = await supportApi.detail(grant.id, false, signal)

      if (detail.state !== 'approved' || detail.revision !== grant.revision) {
        refresh()
        return
      }

      const challenge = await supportApi.challenge(grant.id, signal)

      if (current()) {
        outstanding.current = challenge
        setBound(challenge)
        setMessage('Enter your authenticator code. Verification alone does not activate support.')
        setInvalid(false)
      }
    })
  }
  function verify(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const candidate = code
    setCode('')
    void action.run(async (signal, current) => {
      if (!bound || !MFA_TOTP_CODE.test(candidate)) {
        setInvalid(true)
        setMessage('Enter the current six-digit authenticator code.')
        form.current?.querySelector<HTMLInputElement>('input')?.focus()
        return
      }

      const started = performance.now()

      try {
        const verifiedActor = await mfaApi.verifyChallenge(bound, candidate, signal)

        if (current()) {
          outstanding.current = null
          setBound(null)

          if (!verifiedActor.freshAssuranceExpiresAt || !verifiedActor.assuranceGeneration) {
            setMessage('Proof freshness cannot be confirmed. Check current request, then verify again.')
            return
          }
          // A conservative monotonic deadline starts before verification is sent.
          // The server still verifies the exact current grant-bound proof on activation.

          setProof({ binding, deadline: started + SUPPORT.freshProofMilliseconds })
          setInvalid(false)
          setMessage('Grant-bound TOTP verified for less than five minutes. Activation still requires your explicit confirmation.')
        }
      } catch (error) {
        if (current()) {
          const invalidFlow = error && typeof error === 'object' && 'code' in error && error.code === 'invalid_mfa_flow'
          setInvalid(true)
          setMessage(invalidFlow ? 'This code or challenge was not accepted. Try the current code, or cancel and start verification again.'
            : 'Verification outcome cannot be confirmed. Cancel this challenge, check current request and verify again.')
          form.current?.querySelector<HTMLInputElement>('input')?.focus()
        }
      }
    })
  }
  function cancel(): void {
    void action.run(async (signal, current) => {
      if (bound) {
        await mfaApi.cancelChallenge(bound, signal)
      }

      if (current()) {
        outstanding.current = null
        setBound(null)
        setCode('')
        setProof(null)
        setInvalid(false)
        setMessage('Challenge cancelled. Check current request before starting again.')
        window.setTimeout(() => startButton.current?.focus(), 0)
      }
    })
  }
  function activate(): void {
    if (!verified || performance.now() >= (proof?.deadline ?? 0) || pendingCommand) {
      setProof(null)
      return
    }

    void action.run(async (signal, current) => {
      const result = await executeSupportCommand('activate', { operationId: createUuidV7(), expectedRevision: grant.revision }, grant.id, signal)

      if (result.state !== 'active') {
        throw new SupportAccessError(503)
      }

      if (current()) {
        setProof(null)
        await useAuthStore.getState().revalidateAuthority()
        refresh()
      }
    })
  }
  return <section className="space-y-4 rounded-lg border border-line p-4" aria-label="Grant-bound activation">
    <h3 className="font-semibold">Verify TOTP for this approved grant</h3>
    <p>Activation uses this original session and a fresh TOTP bound to this exact grant and scope. It can happen once, for at most {grant.durationMinutes} minutes. Recovery-only proof cannot activate access.</p>
    {message && <p id="mfa-feedback" role={invalid ? 'alert' : 'status'}>{message}</p>}
    {!bound && !verified && <div className="flex flex-wrap items-center gap-3"><button type="button" className={SUPPORT_BUTTON_CLASS} onClick={refresh}>Check current request</button>
      <button ref={startButton} type="button" className={SUPPORT_BUTTON_CLASS} disabled={action.pending || !!pendingCommand} onClick={start}>Start grant-bound TOTP</button></div>}
    {bound && <form ref={form} onSubmit={verify} className="space-y-3">
      <TotpInput value={code} onChange={setCode} invalid={invalid} disabled={action.pending} />
      <div className="flex flex-wrap gap-3"><button type="submit" className={SUPPORT_BUTTON_CLASS} disabled={action.pending}>Verify TOTP</button>
        <button type="button" className={SUPPORT_BUTTON_CLASS} disabled={action.pending} onClick={cancel}>Cancel this challenge</button></div>
    </form>}
    {verified && <button ref={activateButton} onFocus={() => { activationFocused.current = true }} onBlur={() => { activationFocused.current = false }} type="button" className={SUPPORT_BUTTON_CLASS} disabled={action.pending || !!pendingCommand} onClick={activate}>Activate approved grant</button>}
    {pendingCommand && <p>Inspect the unconfirmed command receipt before starting another activation.</p>}
  </section>
}
