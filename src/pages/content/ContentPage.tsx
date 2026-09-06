import type { FC } from 'react'
import { useState, useMemo } from 'react'
import { useContent, useSubmissions } from '@/hooks/useQueryHooks'
import { DataTable } from '@/components/shared/DataTable'
import { Badge } from '@/components/shared/Badge'
import { ErrorDisplay } from '@/components/shared/ErrorDisplay'
import { EmptyState } from '@/components/shared/EmptyState'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import type { ProductSummary, Submission } from '@/types'

type TabType = 'products' | 'submissions'

const ContentPage: FC = () => {
  const [tab, setTab] = useState<TabType>('products')

  const { data: contentResult, isLoading: contentLoading, error: contentError } = useContent()
  const { data: submissionsResult, isLoading: submissionsLoading, error: submissionsError } = useSubmissions({ page: 1, pageSize: 50 })

  const isLoading = contentLoading || submissionsLoading
  const error = contentError || submissionsError

  const productColumns = useMemo(
    () => [
      {
        key: 'name',
        label: 'Product Name',
        render: (_value: unknown, row: Record<string, unknown>) => (
          <span className="font-medium">{String(row.name ?? '')}</span>
        ),
      },
      {
        key: 'slug',
        label: 'Slug',
        render: (_value: unknown, row: Record<string, unknown>) => (
          <code className="text-xs">{String(row.slug ?? '')}</code>
        ),
      },
      {
        key: 'status',
        label: 'Status',
        render: (_value: unknown, row: Record<string, unknown>) => (
          <Badge variant={String(row.status) === 'active' ? 'success' : 'warning'}>
            {String(row.status ?? 'unknown')}
          </Badge>
        ),
      },
      {
        key: 'updatedAt',
        label: 'Updated',
        render: (_value: unknown, row: Record<string, unknown>) =>
          row.updatedAt ? new Date(String(row.updatedAt)).toLocaleDateString() : '—',
      },
    ],
    []
  )

  const submissionColumns = useMemo(
    () => [
      {
        key: 'id',
        label: 'ID',
        render: (value: unknown) => <code className="text-xs">{String(value)?.slice(0, 8)}...</code>,
      },
      {
        key: 'name',
        label: 'Name',
        render: (_value: unknown, row: Record<string, unknown>) => String(row.name ?? ''),
      },
      {
        key: 'email',
        label: 'Email',
      },
      {
        key: 'product',
        label: 'Product',
        render: (_value: unknown, row: Record<string, unknown>) => String(row.product ?? ''),
      },
      {
        key: 'status',
        label: 'Status',
        render: (value: unknown) => (
          <Badge variant={
            value === 'verified' ? 'success' :
            value === 'pending' ? 'warning' : 'error'
          }>
            {String(value)}
          </Badge>
        ),
      },
      {
        key: 'createdAt',
        label: 'Submitted',
        render: (value: unknown) =>
          value ? new Date(String(value)).toLocaleDateString() : '—',
      },
    ],
    []
  )

  const productData = useMemo(() => {
    return (contentResult || []).map((p: ProductSummary) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      status: p.status,
      updatedAt: p.updatedAt,
    }))
  }, [contentResult])

  const submissionData = useMemo(() => {
    const result = submissionsResult as { data?: Submission[] } | undefined
    return (result?.data || []).map((s: Submission) => ({
      id: s.id,
      name: s.name || '',
      email: s.email,
      product: s.product || '',
      status: s.status,
      createdAt: s.createdAt,
    }))
  }, [submissionsResult])

  if (error) {
    return (
      <ErrorDisplay
        message={error.message || 'Failed to load content'}
        onRetry={() => window.location.reload()}
      />
    )
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-900">Content</h1>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {(['products', 'submissions'] as TabType[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                tab === t
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </nav>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      ) : tab === 'products' ? (
        !productData.length ? (
          <EmptyState
            icon="document-text"
            title="No products found"
            description="Products will appear here once created."
          />
        ) : (
          <DataTable columns={productColumns} data={productData} />
        )
      ) : (
        !submissionData.length ? (
          <EmptyState
            icon="inbox"
            title="No submissions found"
            description="User submissions will appear here."
          />
        ) : (
          <DataTable columns={submissionColumns} data={submissionData} />
        )
      )}
    </div>
  )
}

export default ContentPage
