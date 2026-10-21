import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { operationalTarget, platformViews } from '../../auth/experience'

export function PlatformIndexPage() {
  const { hasPermission } = useAuth()
  const [entry, setEntry] = useState(''), [target, setTarget] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const targeted = Object.entries(platformViews).filter(([view,p]) => view !== 'health' && hasPermission(p))
  return <section className="max-w-3xl space-y-6">
    <h1 className="text-2xl font-bold">Platform operations</h1>
    <p>Operations apply to this installation. Your workspace membership stays unchanged.</p>
    {hasPermission(platformViews.health) && <Link className="inline-flex min-h-11 items-center text-primary underline" to="/platform/health">System Health</Link>}
    {targeted.length > 0 && <>
      <form onSubmit={event => {event.preventDefault(); const id=operationalTarget(entry); setError(!id); setTarget(id)}} className="space-y-3">
        <label className="block" htmlFor="operational-client">Target Client ID</label>
        <input className="w-full rounded border border-control p-3" id="operational-client" value={entry} onChange={event=>{setEntry(event.target.value);setTarget(null)}} aria-invalid={error} aria-describedby={error ? 'target-error' : undefined} />
        {error && <p id="target-error" role="alert">Enter a valid Client UUID.</p>}
        <button className="min-h-11 rounded bg-primary-solid px-4 text-on-accent" type="submit">Select target</button>
      </form>
      {target && <div className="space-y-3"><p className="break-all">Target Client: {target}</p><ul>{targeted.map(([view])=><li key={view}><Link className="inline-flex min-h-11 items-center capitalize text-primary underline" to={`/platform/clients/${target}${view==='metadata'?'':`/${view}`}`}>{view==='metadata'?'Client details':view}</Link></li>)}</ul></div>}
    </>}
  </section>
}
export function WorkspaceAccessPage() {
  return <section><h1 className="text-2xl font-bold">My workspace</h1><p>No workspace destinations are available with your current permissions.</p></section>
}
export function ExperienceDeniedPage() {
  return <section role="alert"><h1>Access denied</h1><p>Your current session does not permit this destination.</p></section>
}
