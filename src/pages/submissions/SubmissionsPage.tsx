import type { FC } from 'react'
import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSubmissions, useRejectSubmission } from '@/hooks/useQueryHooks'
import { DataTable } from '@/components/shared/DataTable'
import { Pagination } from '@/components/shared/Pagination'
import { Badge } from '@/components/shared/Badge'
import { ErrorDisplay } from '@/components/shared/ErrorDisplay'
import { EmptyState } from '@/components/shared/EmptyState'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { Modal } from '@/components/shared/Modal'
import type { Submission, SubmissionStatus as SubmissionStatusType } from '@/types'

const statusColors: Record<SubmissionStatusType, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  pending: 'warning',
  verified: 'success',
  invalid: 'error',
}

const SubmissionsPage: FC = () => {
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [statusFilter, setStatusFilter] = useState<SubmissionStatusType | ''>('')
  const [selectedSubmission, setSelectedSubmission] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [showRejectModal, setShowRejectModal] = useState(false)

  const { data: submissions, isLoading, error } = useSubmissions({ page, pageSize, status: statusFilter || undefined })

  const rejectMutation = useRejectSubmission()

  const handleRejectSubmit = async () => {
    if (selectedSubmission && rejectReason.trim()) {
      await rejectMutation.mutateAsync({ id: selectedSubmission, reason: rejectReason })
      setShowRejectModal(false)
      setSelectedSubmission(null)
      setRejectReason('')
    }
  }

  const columns = useMemo(
    () => [
      {
        key: 'id',
        label: 'ID',
        sortable: true,
        render: (value: unknown, row: Record<string, unknown>) => (
          <button
            onClick={() => navigate(`/submissions/${String(row.id)}`)}
            className="text-sm text-blue-600 hover:text-blue-700 hover:underline"
          >
            {String(value).slice(0, 8)}...
          </button>
        ),
      },
      {
        key: 'status',
        label: 'Status',
        sortable: true,
        render: (value: unknown) => (
          <Badge variant={statusColors[(value as SubmissionStatusType) || 'pending']}>
            {String(value)}
          </Badge>
        ),
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
    [navigate]
  )

  const tableData = useMemo(() => {
    const result = submissions as { data?: Submission[] } | undefined
    const items = result?.data || []
    return items.map((item) => ({
      ...item,
    }) as Record<string, unknown>)
  }, [submissions])

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

      {/* Reject Modal */}
      <Modal
        isOpen={showRejectModal}
        onClose={() => { setShowRejectModal(false); setSelectedSubmission(null); setRejectReason('') }}
        title="Reject Submission"
        footer={
          <>
            <button
              onClick={() => { setShowRejectModal(false); setSelectedSubmission(null); setRejectReason('') }}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleRejectSubmit}
              disabled={!rejectReason.trim() || rejectMutation.isPending}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50"
            >
              {rejectMutation.isPending ? 'Rejecting...' : 'Confirm Rejection'}
            </button>
          </>
        }
      >
        <div className="mt-2">
          <label htmlFor="reject-reason" className="block text-sm font-medium text-gray-700 mb-1">
            Reason for rejection
          </label>
          <textarea
            id="reject-reason"
            rows={4}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm"
            placeholder="Provide a detailed reason..."
          />
        </div>
      </Modal>
    </div>
  )
}

export default SubmissionsPage