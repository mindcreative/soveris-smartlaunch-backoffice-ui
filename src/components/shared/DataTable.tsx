import { ArrowUp, ArrowDown } from 'lucide-react'
import { useState } from 'react'
function sortableValue(value: unknown): string {
  return String(value)
}

export interface Column<T> {
  key: string
  label: string
  sortable?: boolean
  render?: (value: unknown, row: T) => React.ReactNode
  className?: string
}

interface DataTableProps<T> {
  caption?: string
  columns: Column<T>[]
  data: T[]
  onRowClick?: (row: T) => void
  loading?: boolean
  emptyMessage?: string
  className?: string
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  caption,
  data,
  onRowClick,
  loading,
  emptyMessage = 'No data available',
  className = '',
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const sortedData = sortKey
    ? [...data].sort((a, b) => {
        const aVal = a[sortKey]
        const bVal = b[sortKey]
        if (aVal === bVal) return 0
        if (aVal == null) return 1
        if (bVal == null) return -1
        const comparison = sortableValue(aVal).localeCompare(sortableValue(bVal))
        return sortDir === 'asc' ? comparison : -comparison
      })
    : data

  if (loading) {
    return (
      <div className={`bg-surface rounded-lg border border-line ${className}`}>
        <div className="p-8">
          <div className="animate-pulse space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-4 bg-hover rounded"></div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className={`bg-surface rounded-lg border border-line ${className}`}>
        <p className="text-center text-muted py-8">{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div className={`bg-surface rounded-lg border border-line overflow-hidden ${className}`}>
      <div className="overflow-x-auto">
        <table className="w-full">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="bg-subtle border-b border-line">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  onClick={col.sortable ? () => handleSort(col.key) : undefined}
                  aria-sort={col.sortable ? sortKey === col.key ? sortDir === 'asc' ? 'ascending' : 'descending' : 'none' : undefined}
                  className={`px-4 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider ${
                    col.sortable ? 'cursor-pointer hover:bg-subtle' : ''
                  } ${col.className || ''}`}
                >
                  {col.sortable ? <button type="button" aria-label={`Sort by ${col.label}`} title={`Sort by ${col.label}`} className="flex min-h-11 items-center gap-1 rounded" onClick={event => { event.stopPropagation(); handleSort(col.key) }}>
                    {col.label}
                    {sortKey === col.key && <span className="text-primary">{sortDir === 'asc' ? <ArrowUp aria-hidden="true" size={16} /> : <ArrowDown aria-hidden="true" size={16} />}</span>}
                  </button> : col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sortedData.map((row, idx) => (
              <tr
                key={idx}
                onClick={() => onRowClick && onRowClick(row)}
                className={`${onRowClick ? 'cursor-pointer hover:bg-subtle' : ''}`}
              >
                {columns.map((col) => (
                  <td key={col.key} className={`px-4 py-3 text-sm text-foreground ${col.className || ''}`}>
                    {col.render ? col.render(row[col.key], row) : String(row[col.key] ?? '-')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
