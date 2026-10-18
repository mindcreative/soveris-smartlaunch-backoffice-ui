import { LoaderCircle } from 'lucide-react'
interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  fullScreen?: boolean
  message?: string
}

export function LoadingSpinner({ size = 'md', fullScreen = false, message = 'Loading...' }: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: 'w-6 h-6',
    md: 'w-10 h-10',
    lg: 'w-16 h-16',
  }

  const spinner = (
    <LoaderCircle aria-hidden="true" className={`animate-spin text-primary ${sizeClasses[size]}`} />
  )

  if (fullScreen) {
    return (
      <div role="status" aria-live="polite" aria-label={message} className="fixed inset-0 bg-surface/80 backdrop-blur-sm flex flex-col items-center justify-center z-50">
        <div className="flex flex-col items-center gap-4">
          {spinner}
          {message && <p className="text-muted text-sm font-medium">{message}</p>}
        </div>
      </div>
    )
  }

  return (
    <div role="status" aria-live="polite" aria-label={message} className="flex min-h-32 flex-col items-center justify-center gap-3 p-4">
      {spinner}
      {message && <p className="text-muted text-xs">{message}</p>}
    </div>
  )
}

export function CardLoading() {
  return (
    <div className="bg-surface rounded-lg border border-line p-6 animate-pulse">
      <div className="h-4 bg-hover rounded w-1/3 mb-4"></div>
      <div className="space-y-3">
        <div className="h-3 bg-hover rounded w-full"></div>
        <div className="h-3 bg-hover rounded w-4/5"></div>
        <div className="h-3 bg-hover rounded w-3/5"></div>
      </div>
    </div>
  )
}
