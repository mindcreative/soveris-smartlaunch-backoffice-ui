import { useLocation } from 'react-router-dom'

const titles: Record<string, string> = {
  dashboard: 'Dashboard', submissions: 'Submissions', analytics: 'Analytics', products: 'Products', domains: 'Domains',
  users: 'Users', audit: 'Audit Logs', ai: 'AI Tools', billing: 'Billing',
}
const billingTitles: Record<string, string> = { account: 'Account', ledger: 'Ledger', adjustments: 'Adjustment history', subscriptions: 'Subscriptions', reports: 'Reports', reconciliation: 'Reconciliation' }
export function PageContext() {
  const { pathname } = useLocation(), segments = pathname.split('/').filter(Boolean)
  if (segments[0] === 'platform') return <div className="min-w-0 break-words text-sm font-semibold">Platform operations{segments[1] === 'health' ? ' / System Health' : segments[1] === 'clients' ? ' / Selected Client' : ''}</div>
  const title = titles[segments[0]] ?? 'My workspace'
  const detail = segments[0] === 'billing' ? billingTitles[segments[3]] : segments[0] === 'domains' && segments.length > 1 ? 'Domain details' : undefined
  // Object identities are supplied by authorized page content, never URL segments.
  // Existing page Breadcrumbs and h1 focus remain owned by their routed pages.
  return <div className="min-w-0 break-words text-sm font-semibold text-foreground sm:text-base">{title}{detail && <><span aria-hidden="true"> / </span><span className="font-normal">{detail}</span></>}</div>
}
