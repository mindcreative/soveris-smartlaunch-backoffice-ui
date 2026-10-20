import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'

export function BillingWorkspaceNav({ clientId }: { clientId: string }) {
  const location = useLocation()
  const { hasPermission } = useAuth()
  const items = [
    ...(hasPermission('platform:billing:reconcile') ? [{ label: 'Reconciliation', href: `/billing/clients/${clientId}/reconciliation` }] : []),
    ...(hasPermission('billing:view') ? [
      { label: 'Account', href: `/billing/clients/${clientId}/account` },
      { label: 'Ledger', href: `/billing/clients/${clientId}/ledger` },
      { label: 'Usage & expense', href: `/billing/clients/${clientId}/reports` },
      { label: 'Adjustments', href: `/billing/clients/${clientId}/adjustments` },
    ] : []),
    ...(hasPermission('billing:view') || hasPermission('platform:billing:view') || hasPermission('platform:packages:manage') ? [
      { label: 'Subscriptions', href: `/billing/clients/${clientId}/subscriptions` },
    ] : []),
  ]

  return (
    <nav aria-label="Billing workspace" className="mb-6 border-b border-line">
      <ul className="flex flex-wrap gap-2">
        {items.map((item) => {
          const active = location.pathname === item.href
          return (
            <li key={item.label}>
              <Link
                to={item.href}
                aria-current={active ? 'page' : undefined}
                className={`inline-flex min-h-11 items-center border-b-2 px-3 py-2 text-sm font-medium ${
                  active
                    ? 'border-primary-line text-primary'
                    : 'border-transparent text-muted hover:border-control hover:text-foreground'
                }`}
              >
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
