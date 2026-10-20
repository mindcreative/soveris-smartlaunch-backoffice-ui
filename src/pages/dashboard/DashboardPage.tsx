import { RefreshCw } from 'lucide-react'
import type { FC } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useClientWorkspaceDashboard } from '@/hooks/useQueryHooks'
import { StatCard } from '@/components/shared/StatCard'
import { ErrorDisplay } from '@/components/shared/ErrorDisplay'
import { EmptyState } from '@/components/shared/EmptyState'
import { useAuth } from '@/hooks/useAuth'

const DashboardPage: FC = () => {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const { data: metrics, isLoading: metricsLoading, isFetching: metricsFetching, error: metricsError } = useClientWorkspaceDashboard(user?.clientId)

  const handleRefresh = () => {
    if (metricsFetching) return
    queryClient.invalidateQueries({ queryKey: ['backoffice', 'clients', user?.clientId, 'dashboard'] })
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
          disabled={metricsLoading}
          aria-disabled={metricsFetching}
          className="inline-flex items-center px-3 py-2 text-sm font-medium text-foreground bg-surface border border-control rounded-md hover:bg-subtle disabled:opacity-50"
        >
          <RefreshCw aria-hidden="true" className="w-4 h-4 mr-1.5" />
          {metricsFetching && !metricsLoading ? 'Refreshing…' : 'Refresh'}
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
            title="Products"
            value={metrics.products}
          />
        </div>
      ) : (
        <EmptyState
          icon="chart-bar"
          title="No dashboard data yet"
          description="Workspace statistics will appear once you start receiving data."
        />
      )}


    </div>
  )
}

export default DashboardPage
