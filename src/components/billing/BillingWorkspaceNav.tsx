import { Link, useLocation } from 'react-router-dom'

export function BillingWorkspaceNav({ clientId }: { clientId: string }) {
  const location = useLocation()
  const items = [
    { label: 'Account', href: `/billing/clients/${clientId}/account` },
    { label: 'Ledger', href: `/billing/clients/${clientId}/ledger` },
  ]

  return (
    <nav aria-label="Billing workspace" className="mb-6 border-b border-gray-200">
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
                    ? 'border-indigo-600 text-indigo-700'
                    : 'border-transparent text-gray-600 hover:border-gray-300 hover:text-gray-900'
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
