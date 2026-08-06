import type { FC } from 'react'
import { useState, useMemo } from 'react'
import { useUsers, useCreateUser, useDeactivateUser } from '@/hooks/useQueryHooks'
import { DataTable } from '@/components/shared/DataTable'
import { Pagination } from '@/components/shared/Pagination'
import { Badge } from '@/components/shared/Badge'
import { ErrorDisplay } from '@/components/shared/ErrorDisplay'
import { EmptyState } from '@/components/shared/EmptyState'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { Modal } from '@/components/shared/Modal'
import type { BackOfficeUser, UserRole } from '@/types'

const roleColors: Record<UserRole, 'info' | 'warning' | 'neutral'> = {
  Admin: 'info',
  Editor: 'warning',
  Viewer: 'neutral',
}

const initialUserState = {
  email: '',
  password: '',
  displayName: '',
  role: 'Viewer' as UserRole,
}

const UsersPage: FC = () => {
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [formData, setFormData] = useState(initialUserState)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null)

  const { data: users, isLoading, error } = useUsers({ page, pageSize })
  const createUserMutation = useCreateUser()
  const deactivateUserMutation = useDeactivateUser()

  const tableData = useMemo(() => {
    const result = users as { data?: BackOfficeUser[] } | undefined
    const items = result?.data || []
    return items.map((user) => ({
      id: user.id,
      email: user.email,
      name: user.displayName,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt,
    }))
  }, [users])

  const columns = useMemo(
    () => [
      {
        key: 'name',
        label: 'Name',
        sortable: true,
        render: (value: unknown) => <span className="font-medium">{String(value)}</span>,
      },
      {
        key: 'email',
        label: 'Email',
        sortable: true,
      },
      {
        key: 'role',
        label: 'Role',
        sortable: true,
        render: (value: unknown) => (
          <Badge variant={roleColors[(value as UserRole) || 'Viewer']}>
            {String(value)}
          </Badge>
        ),
      },
      {
        key: 'isActive',
        label: 'Status',
        render: (value: unknown) => (
          <Badge variant={value === true ? 'success' : 'error'}>
            {value === true ? 'Active' : 'Inactive'}
          </Badge>
        ),
      },
      {
        key: 'createdAt',
        label: 'Created',
        render: (value: unknown) =>
          value ? new Date(String(value)).toLocaleDateString() : '—',
      },
    ],
    []
  )

  const handleCreateUser = async () => {
    if (formData.email && formData.password && formData.displayName) {
      await createUserMutation.mutateAsync({
        email: formData.email,
        password: formData.password,
        displayName: formData.displayName,
        role: formData.role,
      })
      setShowCreateModal(false)
      setFormData(initialUserState)
    }
  }

  const handleDeactivateUser = async () => {
    if (showDeleteConfirm) {
      await deactivateUserMutation.mutateAsync(showDeleteConfirm)
      setShowDeleteConfirm(null)
    }
  }

  if (error) {
    return (
      <ErrorDisplay
        message={error.message || 'Failed to load users'}
        onRetry={() => window.location.reload()}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Users</h1>
        <button
          onClick={() => setShowCreateModal(true)}
          disabled={!createUserMutation.isPending}
          className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50"
        >
          {createUserMutation.isPending ? 'Creating...' : 'Create User'}
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      ) : !tableData?.length ? (
        <EmptyState
          icon="users"
          title="No users found"
          description="Create your first user to get started."
        />
      ) : (
        <>
          <DataTable columns={columns} data={tableData} />
          {users && typeof users === 'object' && 'meta' in users && (
            <Pagination
              currentPage={page}
              totalPages={Math.ceil(((users as { meta?: { total: number } }).meta?.total || 0) / pageSize)}
              onPageChange={setPage}
            />
          )}
        </>
      )}

      {/* Create User Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => { setShowCreateModal(false); setFormData(initialUserState) }}
        title="Create New User"
        footer={
          <>
            <button
              onClick={() => { setShowCreateModal(false); setFormData(initialUserState) }}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleCreateUser}
              disabled={!formData.email || !formData.password || !formData.displayName || createUserMutation.isPending}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50"
            >
              {createUserMutation.isPending ? 'Creating...' : 'Create User'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
              placeholder="user@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Display Name *</label>
            <input
              type="text"
              value={formData.displayName}
              onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
              placeholder="John Doe"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password *</label>
            <input
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
              placeholder="Min. 8 characters"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <select
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value as UserRole })}
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
            >
              <option value="Viewer">Viewer</option>
              <option value="Editor">Editor</option>
              <option value="Admin">Admin</option>
            </select>
          </div>
        </div>
      </Modal>

      {/* Deactivate Confirmation Modal */}
      <Modal
        isOpen={!!showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(null)}
        title="Deactivate User"
        footer={
          <>
            <button
              onClick={() => setShowDeleteConfirm(null)}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleDeactivateUser}
              disabled={!showDeleteConfirm || deactivateUserMutation.isPending}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50"
            >
               {deactivateUserMutation.isPending ? 'Deactivating...' : 'Deactivate User'}
            </button>
          </>
        }
      >
        <p className="text-sm text-gray-600">
          Are you sure you want to deactivate this user? They will no longer be able to log in.
        </p>
      </Modal>
    </div>
  )
}

export default UsersPage