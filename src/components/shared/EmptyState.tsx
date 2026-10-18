import { Inbox, Users, ChartNoAxesCombined, Search } from 'lucide-react'
import { useEffect, useRef } from 'react'

interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  actionLabel?: string
  onAction?: () => void
  className?: string
}

export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  className = '',
}: EmptyStateProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <div role="status" className={`flex flex-col items-center justify-center p-8 sm:p-12 text-center ${className}`}>
      <div className="w-16 h-16 bg-subtle rounded-full flex items-center justify-center mb-4">
        {(typeof icon === 'string' ? ({ users: <Users aria-hidden="true" size={32} />, 'chart-bar': <ChartNoAxesCombined aria-hidden="true" size={32} />, search: <Search aria-hidden="true" size={32} />, inbox: <Inbox aria-hidden="true" size={32} /> }[icon]) : icon) || (
          <Inbox aria-hidden="true" className="w-8 h-8 text-muted" />
        )}
      </div>
      <h2 ref={headingRef} tabIndex={-1} className="text-foreground font-semibold text-lg mb-1 outline-none focus-visible:ring-2 focus-visible:ring-focus">{title}</h2>
      {description && <p className="text-muted max-w-sm mb-4">{description}</p>}
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="min-h-11 px-4 py-2 bg-primary-solid text-on-accent text-sm rounded-lg hover:bg-primary-hover transition-colors"
        >
          {actionLabel}
        </button>
      )}
    </div>
  )
}
