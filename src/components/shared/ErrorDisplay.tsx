import { ShieldAlert, TriangleAlert } from 'lucide-react'
import { useEffect, useRef } from 'react'

interface ErrorDisplayProps {
  message: string
  detail?: string
  onRetry?: () => void
  className?: string
}

export function ErrorDisplay({ message, detail, onRetry, className = '' }: ErrorDisplayProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <div role="alert" className={`flex flex-col items-center justify-center p-8 text-center ${className}`}>
      <div className="w-16 h-16 bg-danger-soft rounded-full flex items-center justify-center mb-4">
        <TriangleAlert aria-hidden="true" className="w-8 h-8 text-danger" />
      </div>
      <h2 ref={headingRef} tabIndex={-1} className="text-foreground font-semibold mb-1 outline-none focus-visible:ring-2 focus-visible:ring-focus">{message}</h2>
      {detail && <p className="text-muted text-sm max-w-md">{detail}</p>}
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 min-h-11 px-4 py-2 bg-primary-solid text-on-accent text-sm rounded-lg hover:bg-primary-hover transition-colors"
        >
          Try Again
        </button>
      )}
    </div>
  )
}

interface ForbiddenProps {
  message?: string
}

export function Forbidden({ message = 'You do not have permission to access this page.' }: ForbiddenProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <div role="alert" className="flex flex-col items-center justify-center p-8 text-center">
      <div className="w-16 h-16 bg-warning-soft rounded-full flex items-center justify-center mb-4">
        <ShieldAlert aria-hidden="true" className="w-8 h-8 text-warning" />
      </div>
      <h2 ref={headingRef} tabIndex={-1} className="text-foreground font-semibold text-lg mb-1 outline-none focus-visible:ring-2 focus-visible:ring-focus">Access denied</h2>
      <p className="text-muted max-w-md">{message}</p>
    </div>
  )
}

interface NotFoundProps {
  title?: string
  message?: string
  onGoHome?: () => void
}

export function NotFound({ title = 'Page Not Found', message = 'The page you are looking for does not exist.', onGoHome }: NotFoundProps) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center">
      <div className="w-16 h-16 bg-selected rounded-full flex items-center justify-center mb-4">
        <span className="text-3xl font-bold text-primary">404</span>
      </div>
      <h2 className="text-foreground font-semibold text-lg mb-1">{title}</h2>
      <p className="text-muted max-w-md mb-4">{message}</p>
      {onGoHome && (
        <button
          onClick={onGoHome}
          className="min-h-11 px-4 py-2 bg-primary-solid text-on-accent text-sm rounded-lg hover:bg-primary-hover transition-colors"
        >
          Go Home
        </button>
      )}
    </div>
  )
}
