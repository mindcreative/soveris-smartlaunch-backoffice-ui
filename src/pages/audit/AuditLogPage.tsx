import { useState, useMemo } from 'react'
import { useAuditLogs } from '../../hooks/useQueryHooks'
import { DataTable, type Column } from '../../components/shared/DataTable'
import { Pagination } from '../../components/shared/Pagination'
import { Modal } from '../../components/shared/Modal'
import { EmptyState } from '../../components/shared/EmptyState'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { ErrorDisplay } from '../../components/shared/ErrorDisplay'
import type { AuditLogEntry } from '../../api/endpoints'
import { LocalInstant } from '../../timezone/LocalInstant'

// ==================== TYPES ====================

interface AuditLogFilters {
  search: string
  action: string
  resourceType: string
  resultStatus: string
  startDate: string
  endDate: string
}

interface FilterSelectProps {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
  placeholder?: string
}

// ==================== FILTER COMPONENTS ====================

function FilterSelect({ label, value, options, onChange, placeholder = 'All' }: FilterSelectProps) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-3 py-2 border border-control rounded-md text-sm text-foreground bg-surface focus:outline-none focus:ring-2 focus:ring-focus focus:border-primary-line"
      >
        <option value="">{placeholder}</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}

function DateFilter({ label, value, onChange }: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted">{label}</label>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-3 py-2 border border-control rounded-md text-sm text-foreground bg-surface focus:outline-none focus:ring-2 focus:ring-focus focus:border-primary-line"
      />
    </div>
  )
}

// ==================== HELPER FUNCTIONS ====================

const ACTION_OPTIONS = [
  { value: 'CREATE', label: 'Create' },
  { value: 'UPDATE', label: 'Update' },
  { value: 'DELETE', label: 'Delete' },
  { value: 'LOGIN', label: 'Login' },
  { value: 'LOGOUT', label: 'Logout' },
  { value: 'VIEW', label: 'View' },
  { value: 'EXPORT', label: 'Export' },
  { value: 'IMPORT', label: 'Import' },
]

const RESOURCE_TYPE_OPTIONS = [
  { value: 'User', label: 'User' },
  { value: 'Submission', label: 'Submission' },
  { value: 'Configuration', label: 'Configuration' },
  { value: 'Product', label: 'Product' },
  { value: 'Content', label: 'Content' },
  { value: 'Client', label: 'Client' },
  { value: 'AuditLog', label: 'Audit Log' },
]

const RESULT_STATUS_OPTIONS = [
  { value: 'Success', label: 'Success' },
  { value: 'Failure', label: 'Failure' },
  { value: 'Pending', label: 'Pending' },
]

function getStatusBadgeClass(resultStatus?: string): string {
  switch (resultStatus) {
    case 'Success':
      return 'bg-success-soft text-success'
    case 'Failure':
      return 'bg-danger-soft text-danger'
    case 'Pending':
      return 'bg-warning-soft text-warning'
    default:
      return 'bg-subtle text-foreground'
  }
}

function getActionBadgeClass(action: string): string {
  switch (action) {
    case 'CREATE':
      return 'bg-selected text-primary'
    case 'UPDATE':
      return 'bg-warning-soft text-warning'
    case 'DELETE':
      return 'bg-danger-soft text-danger'
    case 'LOGIN':
      return 'bg-success-soft text-success'
    case 'LOGOUT':
      return 'bg-subtle text-foreground'
    default:
      return 'bg-selected text-primary'
  }
}

// ==================== MAIN COMPONENT ====================

export function AuditLogPage() {
  const [filters, setFilters] = useState<AuditLogFilters>({
    search: '',
    action: '',
    resourceType: '',
    resultStatus: '',
    startDate: '',
    endDate: '',
  })
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null)
  const [error, setError] = useState<Error | null>(null)

  // Build filtered params for the hook
  const queryParams = useMemo(() => {
    const params: Record<string, string | number> = {
      page: currentPage,
      pageSize,
    }
    if (filters.action) params.action = filters.action
    if (filters.search) params.userId = filters.search
    if (filters.resourceType) params.entityType = filters.resourceType
    if (filters.startDate) params.startDate = filters.startDate
    if (filters.endDate) params.endDate = filters.endDate
    return params
  }, [filters, currentPage, pageSize])

  const { data, isLoading, isError } = useAuditLogs(queryParams as never)

  // Filter client-side for search and result status (backend may not support these yet)
  const filteredData = useMemo(() => {
    let items: AuditLogEntry[] = []
    if (data && typeof data === 'object') {
      if ('data' in data) items = (data as { data: AuditLogEntry[] }).data || []
      else if ('items' in data) items = (data as { items: AuditLogEntry[] }).items || []
      else items = data as unknown as AuditLogEntry[]
    }
    if (!Array.isArray(items)) return []

    return items.filter((entry) => {
      // Text search across multiple fields
      if (filters.search) {
        const searchLower = filters.search.toLowerCase()
        const matchesSearch =
          entry.action?.toLowerCase().includes(searchLower) ||
          entry.userName?.toLowerCase().includes(searchLower) ||
          entry.entityType?.toLowerCase().includes(searchLower) ||
          JSON.stringify(entry.details)?.toLowerCase().includes(searchLower)
        if (!matchesSearch) return false
      }
      // Result status filter (client-side until backend adds support)
      if (filters.resultStatus) {
        // Store result status in details for now
        const detailStatus = entry.details?.resultStatus as string | undefined
        if (detailStatus !== filters.resultStatus) return false
      }
      return true
    })
  }, [data, filters.search, filters.resultStatus])

  // Handle page size change
  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize)
    setCurrentPage(1)
  }

  // Column definitions (used by DataTable below)
  const columns: Column<Record<string, unknown>>[] = [
    {
      key: 'createdAt',
      label: 'Timestamp',
      sortable: false,
      render: (_value, row) => {
        const r = row as AuditLogEntry
        return (
          <span className="text-muted whitespace-nowrap">
            <LocalInstant value={r.createdAt} />
          </span>
        )
      },
    },
    {
      key: 'userName',
      label: 'User',
      sortable: true,
      render: (_value, row) => {
        const r = row as AuditLogEntry
        return (
          <span className="text-foreground">{r.userName || r.userId || '-'}</span>
        )
      },
    },
    {
      key: 'action',
      label: 'Action',
      sortable: true,
      render: (_value, row) => {
        const r = row as AuditLogEntry
        return (
          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getActionBadgeClass(r.action)}`}>
            {r.action}
          </span>
        )
      },
    },
    {
      key: 'entityType',
      label: 'Resource/Entity',
      sortable: true,
      render: (_value, row) => {
        const r = row as AuditLogEntry
        return (
          <span className="text-foreground">
            {r.entityType}
            {r.entityId && (
              <span className="text-muted ml-1 text-xs">({r.entityId.slice(0, 8)}...)</span>
            )}
          </span>
        )
      },
    },
    {
      key: 'resultStatus',
      label: 'Result',
      sortable: true,
      render: (_value, row) => {
        const r = row as AuditLogEntry
        const status = r.details?.resultStatus as string | undefined
        return (
          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusBadgeClass(status)}`}>
            {status || 'N/A'}
          </span>
        )
      },
    },
    {
      key: 'ipAddress',
      label: 'IP Address',
      sortable: false,
      render: (_value, row) => {
        const r = row as AuditLogEntry
        return (
          <span className="text-muted font-mono text-xs">{r.ipAddress || '-'}</span>
        )
      },
    },
  ]

  // Total count from paginated response
  const totalCount = useMemo(() => {
    if (data && typeof data === 'object') {
      if ('total' in data) return (data as { total?: number }).total || 0
      if ('totalCount' in data) return (data as { totalCount?: number }).totalCount || 0
      if ('pageCount' in data) return (data as { pageCount?: number }).pageCount || 0
    }
    return filteredData.length
  }, [data, filteredData.length])

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

  if (isError && !isLoading) {
    setError(new Error('Failed to load audit logs'))
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Audit Logs</h1>
        <p className="mt-1 text-sm text-muted">
          Search and filter system activity records. Requires current audit permission.
        </p>
      </div>

      {/* Search Bar */}
      <div className="bg-surface rounded-lg border border-line p-4">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <input
                type="text"
                placeholder="Search by action, user, resource, or details..."
                value={filters.search}
                onChange={(e) => {
                  setFilters((prev) => ({ ...prev, search: e.target.value }))
                  setCurrentPage(1)
                }}
                className="w-full px-4 py-2 border border-control rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-focus focus:border-primary-line"
              />
            </div>
          </div>

          {/* Filter Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            <FilterSelect
              label="Action"
              value={filters.action}
              options={ACTION_OPTIONS}
              onChange={(value) => {
                setFilters((prev) => ({ ...prev, action: value }))
                setCurrentPage(1)
              }}
            />
            <FilterSelect
              label="Resource Type"
              value={filters.resourceType}
              options={RESOURCE_TYPE_OPTIONS}
              onChange={(value) => {
                setFilters((prev) => ({ ...prev, resourceType: value }))
                setCurrentPage(1)
              }}
            />
            <FilterSelect
              label="Result Status"
              value={filters.resultStatus}
              options={RESULT_STATUS_OPTIONS}
              onChange={(value) => {
                setFilters((prev) => ({ ...prev, resultStatus: value }))
                setCurrentPage(1)
              }}
            />
            <DateFilter
              label="From Date"
              value={filters.startDate}
              onChange={(value) => {
                setFilters((prev) => ({ ...prev, startDate: value }))
                setCurrentPage(1)
              }}
            />
            <DateFilter
              label="To Date"
              value={filters.endDate}
              onChange={(value) => {
                setFilters((prev) => ({ ...prev, endDate: value }))
                setCurrentPage(1)
              }}
            />
            {(filters.action || filters.resourceType || filters.resultStatus || filters.startDate || filters.endDate || filters.search) && (
              <button
                onClick={() => {
                  setFilters({
                    search: '',
                    action: '',
                    resourceType: '',
                    resultStatus: '',
                    startDate: '',
                    endDate: '',
                  })
                  setCurrentPage(1)
                }}
                className="px-4 py-2 text-sm font-medium text-foreground bg-subtle border border-control rounded-md hover:bg-hover self-end"
              >
                Clear Filters
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <ErrorDisplay
          message={error.message}
          detail="Failed to load audit logs. Please try again."
          onRetry={() => window.location.reload()}
        />
      )}

      {/* Data Table */}
      {!error && (
        <>
          {isLoading ? (
            <div className="bg-surface rounded-lg border border-line">
              <div className="p-8 flex items-center justify-center">
                <LoadingSpinner />
              </div>
            </div>
          ) : filteredData.length === 0 ? (
            <EmptyState
              title="No audit logs found"
              description="Try adjusting your search or filter criteria."
              icon="search"
            />
          ) : (
            <div className="bg-surface rounded-lg border border-line overflow-hidden">
              <DataTable<Record<string, unknown>>
                columns={columns}
                data={filteredData}
                onRowClick={(row) => setSelectedLog(row as AuditLogEntry)}
                loading={false}
                emptyMessage="No audit logs match your filters."
              />
              {/* Pagination */}
              <div className="border-t border-line px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted">Show</span>
                  <select
                    value={pageSize}
                    onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                    className="px-2 py-1 border border-control rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-focus"
                  >
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                  <span className="text-sm text-muted">per page</span>
                </div>
                <Pagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onPageChange={(page) => {
                    setCurrentPage(page)
                    window.scrollTo({ top: 0, behavior: 'smooth' })
                  }}
                  totalItems={totalCount}
                  itemsPerPage={pageSize}
                />
              </div>
            </div>
          )}
        </>
      )}

      {/* Detail Modal */}
      <Modal
        isOpen={!!selectedLog}
        onClose={() => setSelectedLog(null)}
        title="Audit Log Details"
        size="lg"
        footer={
          <button
            onClick={() => setSelectedLog(null)}
            className="px-4 py-2 text-sm font-medium text-on-accent bg-primary-solid border border-transparent rounded-md hover:bg-primary-hover"
          >
            Close
          </button>
        }
      >
        {selectedLog && (
          <div className="space-y-4">
            {/* Basic Info */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <dt className="text-sm font-medium text-muted">ID</dt>
                <dd className="mt-1 text-sm text-foreground font-mono">{selectedLog.id}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted">Timestamp</dt>
                <dd className="mt-1 text-sm text-foreground"><LocalInstant value={selectedLog.createdAt} /></dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted">User</dt>
                <dd className="mt-1 text-sm text-foreground">{selectedLog.userName || selectedLog.userId || '-'}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted">Action</dt>
                <dd className="mt-1">
                  <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getActionBadgeClass(selectedLog.action)}`}>
                    {selectedLog.action}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted">Resource Type</dt>
                <dd className="mt-1 text-sm text-foreground">{selectedLog.entityType || '-'}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted">Resource ID</dt>
                <dd className="mt-1 text-sm text-foreground font-mono">{selectedLog.entityId || '-'}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted">IP Address</dt>
                <dd className="mt-1 text-sm text-foreground font-mono">{selectedLog.ipAddress || '-'}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted">User Agent</dt>
                <dd className="mt-1 text-xs text-muted break-all">{selectedLog.userAgent || '-'}</dd>
              </div>
            </div>

            {/* Details JSON */}
            {selectedLog.details && Object.keys(selectedLog.details).length > 0 && (
              <div>
                <dt className="text-sm font-medium text-muted mb-2">Details / Metadata</dt>
                <pre className="bg-subtle border border-line rounded-md p-4 text-xs text-foreground overflow-x-auto whitespace-pre-wrap">
                  {JSON.stringify(selectedLog.details, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
