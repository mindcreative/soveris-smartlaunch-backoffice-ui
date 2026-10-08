import { useEffect, useRef, useState } from 'react'
import { prepareAiBackend } from '../../api/aiBackendPreparation'

// Preparation remains separate from capability eligibility, quoting and admission.
export function AiBackendPreparationButton({ kind, allowed, onReady }: {
  kind: 'content' | 'image'; allowed: boolean; onReady: () => Promise<unknown>
}) {
  const [state, setState] = useState<'idle' | 'preparing' | 'ready' | 'unavailable'>('idle')
  const pending = useRef<AbortController | null>(null)
  useEffect(() => () => pending.current?.abort(), [])
  useEffect(() => {
    if (!allowed) {
      pending.current?.abort()
      pending.current = null
    }
  }, [allowed])
  const [previousAllowed, setPreviousAllowed] = useState(allowed)
  if (previousAllowed !== allowed) {
    setPreviousAllowed(allowed)
    setState('idle')
  }
  async function prepare() {
    if (!allowed || pending.current) return
    const controller = new AbortController()
    pending.current = controller; setState('preparing')
    try {
      await prepareAiBackend(kind, controller.signal)
      if (controller.signal.aborted || pending.current !== controller) return
      await onReady()
      if (!controller.signal.aborted && pending.current === controller) setState('ready')
    } catch { if (!controller.signal.aborted && pending.current === controller) setState('unavailable') }
    finally { if (pending.current === controller) pending.current = null }
  }
  if (!allowed) return null
  return <div className="space-y-2">
    <button type="button" disabled={state === 'preparing'} onClick={() => { void prepare() }}
      className="min-h-11 rounded border border-gray-400 px-3 disabled:opacity-50">
      {state === 'preparing' ? 'Preparing AI…' : 'Prepare AI'}
    </button>
    <p role="status" className="text-sm text-gray-700">
      {state === 'ready' ? 'AI is ready. Generation still requires eligibility and admission.' :
        state === 'unavailable' ? 'AI preparation is unavailable or busy. No generation was submitted.' :
        'Prepare processing without submitting a generation or reserving credits.'}
    </p>
  </div>
}
