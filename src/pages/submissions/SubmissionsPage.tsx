import type { FC } from 'react'
import { useState, useMemo } from 'react'
import { useSubmissions, useSubmission } from '@/hooks/useQueryHooks'
import { DataTable } from '@/components/shared/DataTable'
import { Pagination } from '@/components/shared/Pagination'
import { Badge } from '@/components/shared/Badge'
import { ErrorDisplay } from '@/components/shared/ErrorDisplay'
import { EmptyState } from '@/components/shared/EmptyState'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { SubmissionDetailPanel } from '@/components/submissions/SubmissionDetailPanel'
import type { Submission, SubmissionStatus as SubmissionStatusType } from '@/types'

const statusColors: Record<SubmissionStatusType, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  pending: 'warning',
  verified: 'success',
  invalid: 'error',
}

const SubmissionsPage: FC = () => {
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [statusFilter, setStatusFilter] = useState<SubmissionStatusType | ''>('')
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<string | null>(null)

  const { data: submissions, isLoading, error } = useSubmissions({ page, pageSize, status: statusFilter || undefined })
  const { data: selectedSubmission, isLoading: submissionLoading, error: submissionError } = useSubmission(
    selectedSubmissionId || '',
  )

  const columns = useMemo(
    () => [
      {
        key: 'id',
        label: 'ID',
        sortable: true,
        render: (value: unknown, row: Record<string, unknown>) => (
          <button
            onClick={() => setSelectedSubmissionId(String(row.id))}
            className="text-sm text-blue-600 hover:text-blue-700 hover:underline"
          >
            {String(value).slice(0, 12)}...
          </button>
        ),
      },
      {
        key: 'status',
        label: 'Status',
        sortable: true,
        render: (value: unknown) => {
          const typedValue = value as SubmissionStatusType | undefined
          const isBackendField = value != null && (value as unknown as Record<string, unknown>).isVerified !== undefined
          if (isBackendField) {
            const isVerified = (value as unknown as Record<string, unknown>).isVerified as boolean | undefined
            const resolvedStatus = isVerified === true ? 'verified' : 'pending'
            return (
              <Badge variant={statusColors[resolvedStatus]}>
                {isVerified ? 'Verified' : 'Pending'}
              </Badge>
            )
          }
          return (
            <Badge variant={statusColors[typedValue || 'pending']}>
              {String(typedValue || 'pending')}
            </Badge>
          )
        },
      },
      {
        key: 'submittedAt',
        label: 'Submitted',
        sortable: true,
        render: (value: unknown) =>
          value ? new Date(String(value)).toLocaleDateString() : '-',
      },
      {
        key: 'product',
        label: 'Product',
        render: (_value: unknown, row: Record<string, unknown>) =>
          (row.productName as string) || (row.productId as string) || '-',
      },
    ],
    [],
  )

  const tableData = useMemo(() => {
    const result = submissions as { data?: Submission[] } | undefined
    const items = result?.data || []
    return items.map((item) => ({
      ...item,
    }) as Record<string, unknown>)
  }, [submissions])

  const handleClosePanel = () => setSelectedSubmissionId(null)

  if (error) {
    return <ErrorDisplay message={error.message || 'Failed to load submissions'} onRetry={() => window.location.reload()} />
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Submissions</h1>
        <div className="flex items-center gap-3">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as SubmissionStatusType | '')}
            className="text-sm border border-gray-300 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="verified">Verified</option>
            <option value="invalid">Invalid</option>
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      ) : !tableData?.length ? (
        <EmptyState
          icon="inbox"
          title="No submissions found"
          description="There are no submission records matching your criteria."
        />
      ) : (
        <>
          <DataTable columns={columns} data={tableData} />
          {submissions && typeof submissions === 'object' && 'meta' in submissions && (
            <Pagination
              currentPage={page}
              totalPages={Math.ceil(((submissions as { meta?: { total: number } }).meta?.total || 0) / pageSize)}
              onPageChange={setPage}
            />
          )}
        </>
      )}

      {/* Submission Detail Panel */}
      <SubmissionDetailPanel
        submission={selectedSubmission ?? null}
        isLoading={submissionLoading}
        error={submissionError}
        isOpen={selectedSubmissionId !== null}
        onClose={handleClosePanel}
      />

      {/* NOTE: Reject/Update status endpoints do not exist in the API.
          Status changes must be done via direct API calls or admin tools. */}
    </div>
  )
}

export default SubmissionsPage
