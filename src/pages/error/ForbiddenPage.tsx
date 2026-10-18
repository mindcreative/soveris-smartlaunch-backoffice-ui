import { ShieldAlert } from 'lucide-react'
import type { FC } from 'react'
import { useNavigate } from 'react-router-dom'

const ForbiddenPage: FC = () => {
  const navigate = useNavigate()

  return (
    <div className="flex items-center justify-center min-h-screen bg-subtle">
      <div className="text-center px-4">
        <div className="inline-flex items-center justify-center w-20 h-20 mx-auto mb-6 rounded-full bg-danger-soft">
          <ShieldAlert aria-hidden="true" className="w-10 h-10 text-danger" />
        </div>
        <h1 className="text-3xl font-bold text-foreground mb-2">403 — Access Denied</h1>
        <p className="text-muted mb-6 max-w-md mx-auto">
          You don't have permission to access this page. Your role does not have the required
          privileges.
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="px-4 py-2 text-sm font-medium text-foreground bg-surface border border-control rounded-md hover:bg-subtle"
          >
            Go Back
          </button>
          <button
            onClick={() => navigate('/dashboard')}
            className="px-4 py-2 text-sm font-medium text-on-accent bg-primary-solid rounded-md hover:bg-primary-hover"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    </div>
  )
}

export default ForbiddenPage