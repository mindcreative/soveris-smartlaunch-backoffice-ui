import type { FC } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useOverviewMetrics, useAuditLogs, useHealthCheck } from '@/hooks/useQueryHooks'
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
  const { data: activity, isLoading: activityLoading, error: activityError } = useAuditLogs({ page: 1, pageSize: 10 })
  const { data: health, isLoading: healthLoading, error: healthError } = useHealthCheck()

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['backoffice'] })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Welcome back, {user?.displayName || 'User'}
          </h1>
          <p className="mt-1 text-sm text-gray-500">Here's what's happening with your backoffice today.</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={metricsLoading || activityLoading || healthLoading}
          className="inline-flex items-center px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
        >
          <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Stats Cards */}
      {metricsLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-lg border border-gray-200 p-6 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-20 mb-2"></div>
              <div className="h-8 bg-gray-200 rounded w-24 mb-1"></div>
              <div className="h-3 bg-gray-200 rounded w-16"></div>
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
            value={metrics.totalVerified}
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

      {/* Activity & Health */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Activity */}
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">Recent Activity</h2>
            <button
              onClick={() => navigate('/audit')}
              className="text-xs text-blue-600 hover:text-blue-700"
            >
              View all
            </button>
          </div>
          {activityLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="animate-pulse flex items-center gap-3">
                  <div className="w-2 h-2 bg-gray-200 rounded-full"></div>
                  <div className="h-3 bg-gray-200 rounded flex-1"></div>
                </div>
              ))}
            </div>
          ) : activityError ? (
            <ErrorDisplay message={activityError.message} onRetry={handleRefresh} />
          ) : activity?.data?.length ? (
            <ul className="divide-y divide-gray-100">
              {activity.data.slice(0, 5).map((item: { action?: string; description?: string; userName?: string; createdAt: string }, idx: number) => (
                <li key={idx} className="px-4 py-3 hover:bg-gray-50">
                  <div className="flex items-start gap-3">
                    <div className="w-2 h-2 bg-blue-500 rounded-full mt-1.5 shrink-0" />
                    <div>
                      <p className="text-sm text-gray-800">{item.action || item.description || 'Activity event'}</p>
                      <p className="text-xs text-gray-500">
                        {item.userName && `${item.userName} — `}
                        {new Date(item.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-6 text-center text-sm text-gray-500">No recent activity</div>
          )}
        </div>

        {/* System Health */}
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="px-4 py-3 border-b border-gray-200">
            <h2 className="text-sm font-semibold text-gray-900">System Health</h2>
          </div>
          {healthLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="animate-pulse flex items-center justify-between">
                  <div className="h-4 bg-gray-200 rounded w-1/3"></div>
                  <div className="h-5 bg-gray-200 rounded w-1/6"></div>
                </div>
              ))}
            </div>
          ) : healthError ? (
            <ErrorDisplay message={healthError.message} onRetry={handleRefresh} />
          ) : health ? (
            <div className="divide-y divide-gray-100">
              <div className="px-4 py-3 flex items-center justify-between">
                <span className="text-sm text-gray-700">API</span>
                <Badge variant={health.status === 'healthy' ? 'success' : 'error'}>
                  {health.status}
                </Badge>
              </div>
              <div className="px-4 py-3 flex items-center justify-between">
                <span className="text-sm text-gray-700">Database</span>
                <Badge variant={health.database === 'ok' ? 'success' : 'error'}>
                  {health.database}
                </Badge>
              </div>
              <div className="px-4 py-3 flex items-center justify-between">
                <span className="text-sm text-gray-700">Redis</span>
                <Badge variant={health.redis === 'ok' ? 'success' : 'error'}>
                  {health.redis}
                </Badge>
              </div>
            </div>
          ) : (
            <div className="p-6 text-center text-sm text-gray-500">Health data unavailable</div>
          )}
        </div>
      </div>
    </div>
  )
}

export default DashboardPage
