import { Link, useLocation } from 'react-router-dom'
import { useBillingAccess, billingPath } from '../../auth/ExperienceContext'

export function BillingWorkspaceNav({ clientId }: { clientId: string }) {
  const location = useLocation()
  const { hasPermission, audience } = useBillingAccess()
  const sections = [
    ...(hasPermission('billing:view') ? [
      ['Account','account'], ['Ledger','ledger'], [audience==='platform'?'Usage & expense':'Credit usage','reports'],
      ['Adjustments','adjustments'], ['Subscriptions','subscriptions'],
    ] : []),
    ...(hasPermission('platform:billing:reconcile') ? [['Reconciliation','reconciliation']] : []),
  ]
  return <nav aria-label={audience === 'platform' ? 'Platform financial views' : 'Billing workspace'} className="mb-6 border-b border-line">
    <ul className="flex flex-wrap gap-2">{sections.map(([label, section]) => {
      const href=billingPath(audience,clientId,section)
      return <li key={section}><Link to={href} aria-current={location.pathname===href?'page':undefined}
        className={`inline-flex min-h-11 items-center border-b-2 px-3 py-2 text-sm font-medium ${location.pathname===href?'border-primary-line text-primary':'border-transparent text-muted hover:border-control hover:text-foreground'}`}>{label}</Link></li>
    })}</ul>
  </nav>
}
