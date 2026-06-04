import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

interface User {
  id: string
  email: string
  displayName: string
  role: 'Admin' | 'Editor' | 'Viewer'
  clientId: string
}

interface AuthContextType {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  hasPermission: (permission: string) => boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

// Permission matrix for roles
const ROLE_PERMISSIONS: Record<string, string[]> = {
  Admin: ['*'],
  Editor: [
    'submissions:view',
    'submissions:delete',
    'submissions:export',
    'analytics:view',
    'content:view',
    'content:update',
    'ai:view',
    'ai:create'
  ],
  Viewer: [
    'submissions:view',
    'analytics:view',
    'content:view',
    'audit:view'
  ]
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const hasPermission = useCallback((permission: string) => {
    if (!user) return false
    const permissions = ROLE_PERMISSIONS[user.role] || []
    return permissions.includes('*') || permissions.includes(permission)
  }, [user])

  const login = useCallback(async (_email: string, _password: string) => {
    setIsLoading(true)
    try {
      // TODO: Implement actual login logic
      const mockUser: User = {
        id: '1',
        email: 'admin@soveris.com',
        displayName: 'Admin User',
        role: 'Admin',
        clientId: 'default-client-id'
      }
      setUser(mockUser)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const logout = useCallback(() => {
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading, login, logout, hasPermission }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}