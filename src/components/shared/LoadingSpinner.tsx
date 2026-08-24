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
    <div aria-hidden="true" className={`border-4 border-gray-200 border-t-blue-600 rounded-full animate-spin ${sizeClasses[size]}`}></div>
  )

  if (fullScreen) {
    return (
      <div role="status" aria-live="polite" aria-label={message} className="fixed inset-0 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center z-50">
        <div className="flex flex-col items-center gap-4">
          {spinner}
          {message && <p className="text-gray-600 text-sm font-medium">{message}</p>}
        </div>
      </div>
    )
  }

  return (
    <div role="status" aria-live="polite" aria-label={message} className="flex min-h-32 flex-col items-center justify-center gap-3 p-4">
      {spinner}
      {message && <p className="text-gray-500 text-xs">{message}</p>}
    </div>
  )
}

export function CardLoading() {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 animate-pulse">
      <div className="h-4 bg-gray-200 rounded w-1/3 mb-4"></div>
      <div className="space-y-3">
        <div className="h-3 bg-gray-200 rounded w-full"></div>
        <div className="h-3 bg-gray-200 rounded w-4/5"></div>
        <div className="h-3 bg-gray-200 rounded w-3/5"></div>
      </div>
    </div>
  )
}
