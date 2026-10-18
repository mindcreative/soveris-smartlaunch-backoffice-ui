import { RefreshCw } from 'lucide-react'
import type { FC } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useOverviewMetrics, useHealthCheck } from '@/hooks/useQueryHooks'
import { StatCard } from '@/components/shared/StatCard'
import { ErrorDisplay } from '@/components/shared/ErrorDisplay'
import { Badge } from '@/components/shared/Badge'
import { EmptyState } from '@/components/shared/EmptyState'
import { useAuth } from '@/hooks/useAuth'

const DashboardPage: FC = () => {
  const navigate = useNavigate()
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const { data: metrics, isLoading: metricsLoading, error: metricsError } = useOverviewMetrics()
  const { data: health, isLoading: healthLoading, error: healthError } = useHealthCheck()

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['backoffice'] })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Welcome back, {user?.displayName || 'User'}
          </h1>
          <p className="mt-1 text-sm text-muted">Here's what's happening in your workspace today.</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={metricsLoading || healthLoading}
          className="inline-flex items-center px-3 py-2 text-sm font-medium text-foreground bg-surface border border-control rounded-md hover:bg-subtle disabled:opacity-50"
        >
          <RefreshCw aria-hidden="true" className="w-4 h-4 mr-1.5" />
          Refresh
        </button>
      </div>

      {/* Stats Cards */}
      {metricsLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-surface rounded-lg border border-line p-6 animate-pulse">
              <div className="h-4 bg-hover rounded w-20 mb-2"></div>
              <div className="h-8 bg-hover rounded w-24 mb-1"></div>
              <div className="h-3 bg-hover rounded w-16"></div>
            </div>
          ))}
        </div>
      ) : metricsError ? (
        <ErrorDisplay message={metricsError.message || 'Failed to load dashboard stats'} onRetry={handleRefresh} />
      ) : metrics ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Total Submissions"
            value={metrics.totalSubmissions}
            change={{ value: 12, isPositive: true }}
          />
          <StatCard
            title="Verified"
            value={metrics.verifiedSubmissions}
            change={{ value: 8, isPositive: true }}
          />
          <StatCard
            title="Verification Rate"
            value={`${(metrics.verificationRate * 100).toFixed(1)}%`}
          />
          <StatCard
            title="Conversion Rate"
            value={`${(metrics.conversionRate * 100).toFixed(1)}%`}
          />
        </div>
      ) : (
        <EmptyState
          icon="chart-bar"
          title="No dashboard data yet"
          description="Dashboard statistics will appear once you start receiving data."
          actionLabel="View Analytics"
          onAction={() => navigate('/analytics')}
        />
      )}

      {/* System Health */}
      <div className="bg-surface rounded-lg border border-line">
        <div className="px-4 py-3 border-b border-line">
          <h2 className="text-sm font-semibold text-foreground">System Health</h2>
        </div>
        {healthLoading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="animate-pulse flex items-center justify-between">
                <div className="h-4 bg-hover rounded w-1/3"></div>
                <div className="h-5 bg-hover rounded w-1/6"></div>
              </div>
            ))}
          </div>
        ) : healthError ? (
          <ErrorDisplay message={healthError.message} onRetry={handleRefresh} />
        ) : health ? (
          <div className="divide-y divide-line">
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="text-sm text-foreground">API</span>
              <Badge variant={health.status === 'healthy' ? 'success' : 'error'}>
                {health.status}
              </Badge>
            </div>
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="text-sm text-foreground">Database</span>
              <Badge variant={health.database === 'ok' ? 'success' : 'error'}>
                {health.database}
              </Badge>
            </div>
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="text-sm text-foreground">Redis</span>
              <Badge variant={health.redis === 'ok' ? 'success' : 'error'}>
                {health.redis}
              </Badge>
            </div>
          </div>
        ) : (
          <div className="p-6 text-center text-sm text-muted">Health data unavailable</div>
        )}
      </div>
    </div>
  )
}

export default DashboardPage
