import { useAuth } from '../../hooks/useAuth'

export function TopBar() {
  const { user, logout } = useAuth()

  return (
    <div className="sticky top-0 z-40 bg-white border-b border-gray-200">
      <div className="flex h-16 items-center justify-between px-4 sm:px-6">
        {/* Left side - Title */}
        <div className="flex items-center">
          <h2 className="text-lg font-semibold text-gray-900">Soveris Back-Office</h2>
        </div>

        {/* Right side - User info and logout */}
        <div className="flex items-center space-x-4">
          {/* User info */}
          {user && (
            <div className="flex items-center space-x-3">
              <div className="text-right">
                <p className="text-sm font-medium text-gray-900">{user.displayName}</p>
                <p className="text-xs text-gray-500">{user.email}</p>
              </div>
              <div className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-medium ${
                user.role === 'Admin' ? 'bg-indigo-100 text-indigo-700' :
                user.role === 'Editor' ? 'bg-green-100 text-green-700' :
                'bg-gray-100 text-gray-700'
              }`}>
                {user.displayName.charAt(0)}
              </div>
            </div>
          )}

          {/* Logout button */}
          <button
            onClick={logout}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Logout
          </button>
        </div>
      </div>
    </div>
  )
}