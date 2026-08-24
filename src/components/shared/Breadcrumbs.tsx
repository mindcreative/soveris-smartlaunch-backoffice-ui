import { Link } from 'react-router-dom'

export interface BreadcrumbItem {
  label: string
  href?: string
}

export function Breadcrumbs({ items }: { items: readonly BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4 overflow-x-auto">
      <ol className="flex min-w-max items-center gap-2 text-sm text-gray-600">
        {items.map((item, index) => {
          const current = index === items.length - 1
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-2">
              {index > 0 && <span aria-hidden="true">/</span>}
              {item.href && !current ? (
                <Link
                  to={item.href}
                  className="min-h-11 inline-flex items-center rounded px-1 font-medium text-indigo-700 hover:underline"
                >
                  {item.label}
                </Link>
              ) : (
                <span aria-current={current ? 'page' : undefined} className="px-1">
                  {item.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
