import type { FC } from 'react'
import { useMemo } from 'react'
import { useOverviewMetrics } from '@/hooks/useQueryHooks'
import { StatCard } from '@/components/shared/StatCard'
import { DataTable } from '@/components/shared/DataTable'
import { ErrorDisplay } from '@/components/shared/ErrorDisplay'
import { EmptyState } from '@/components/shared/EmptyState'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'

const AnalyticsPage: FC = () => {
  const { data: overview, isLoading: overviewLoading, error: overviewError } = useOverviewMetrics()

  const isLoading = overviewLoading
  const error = overviewError

  const statsCards = useMemo(() => {
    if (!overview) return []

    const totalSubmissions = overview.totalSubmissions ?? 0
    const verifiedCount = overview.totalVerified ?? 0
    const verificationRate = overview.verificationRate ?? 0
    const conversionRate = overview.conversionRate ?? 0

    return [
      {
        title: 'Total Submissions',
        value: totalSubmissions,
      },
      {
        title: 'Verification Rate',
        value: `${verificationRate}%`,
      },
      {
        title: 'Conversion Rate',
        value: `${conversionRate}%`,
      },
      {
        title: 'Verified',
        value: verifiedCount,
      },
    ]
  }, [overview])

  const topProductsColumns = useMemo(
    () => [
      { key: 'productName', label: 'Product' },
      {
        key: 'submissions',
        label: 'Submissions',
        render: (value: unknown) => <strong>{String(value)}</strong>,
      },
      {
        key: 'verified',
        label: 'Verified',
        render: (value: unknown) => <span className="text-green-600 font-medium">{String(value)}</span>,
      },
      {
        key: 'conversionRate',
        label: 'Conv. Rate',
        render: (value: unknown) => `${(Number(value) * 100).toFixed(1)}%`,
      },
    ],
    []
  )

  // NOTE: ProductBreakdown is a single object from API (requires productId).
  // The /analytics/products endpoint was renamed to /analytics/products/{productId}.
  // Placeholder: show empty state until a product selector is added.
  const topProductsData: Array<{ productName: string; submissions: number; verified: number; conversionRate: number }> = []

  if (error) {
    return (
      <ErrorDisplay
        message={error.message || 'Failed to load analytics data'}
        onRetry={() => window.location.reload()}
      />
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-gray-900">Analytics</h1>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      ) : (
        <>
          {/* Stats Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {statsCards.map((card) => (
              <StatCard
                key={card.title}
                title={card.title}
                value={card.value}
              />
            ))}
          </div>

          {/* Top Products Table */}
          <div>
            <h2 className="text-base font-semibold text-gray-900 mb-3">Product Breakdown</h2>
            {!topProductsData.length ? (
              <EmptyState
                icon="chart-bar"
                title="No product data available"
                description="Product analytics will appear once submissions start coming in."
              />
            ) : (
              <DataTable columns={topProductsColumns} data={topProductsData} />
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default AnalyticsPage