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
      <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
        <svg className="w-8 h-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
      </div>
      <h2 ref={headingRef} tabIndex={-1} className="text-gray-900 font-semibold mb-1 outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">{message}</h2>
      {detail && <p className="text-gray-500 text-sm max-w-md">{detail}</p>}
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 min-h-11 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
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
      <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mb-4">
        <svg className="w-8 h-8 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
      </div>
      <h2 ref={headingRef} tabIndex={-1} className="text-gray-900 font-semibold text-lg mb-1 outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">Access denied</h2>
      <p className="text-gray-500 max-w-md">{message}</p>
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
      <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4">
        <span className="text-3xl font-bold text-blue-600">404</span>
      </div>
      <h2 className="text-gray-900 font-semibold text-lg mb-1">{title}</h2>
      <p className="text-gray-500 max-w-md mb-4">{message}</p>
      {onGoHome && (
        <button
          onClick={onGoHome}
          className="min-h-11 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
        >
          Go Home
        </button>
      )}
    </div>
  )
}
