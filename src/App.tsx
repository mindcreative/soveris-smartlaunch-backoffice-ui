import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastContainer } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import { AuthProvider } from './hooks/useAuth'
import { AdminShell } from './components/layout/AdminShell'
import Login from './pages/login/LoginPage'
import Dashboard from './pages/dashboard/DashboardPage'
import Submissions from './pages/submissions/SubmissionsPage'
import Analytics from './pages/analytics/AnalyticsPage'
import Content from './pages/content/ContentPage'
import Users from './pages/users/UsersPage'
import { AuditLogPage } from './pages/audit'
import Forbidden from './pages/error/ForbiddenPage'
import { useAuthGuard } from './hooks/useAuthGuard'
import type { UserRole } from './types/auth'

// Create QueryClient instance
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5 * 60 * 1000, // 5 minutes
    },
  },
})

// Protected route wrapper with role-based access
function ProtectedRoute({
  children,
  requiredRole,
}: {
  children: React.ReactNode
  requiredRole?: UserRole
}) {
  const { hasAccess } = useAuthGuard({ requiredRole })
  if (!hasAccess()) {
    return <Navigate to="/forbidden" replace />
  }
  return <>{children}</>
}

function App() {
  return (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<Login />} />
            <Route path="/forbidden" element={<Forbidden />} />

            {/* Protected routes under AdminShell */}
            <Route element={<AdminShell />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/submissions" element={<Submissions />} />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/content" element={<Content />} />
              <Route path="/users" element={<Users />} />

              {/* Placeholder routes for future pages */}
              <Route path="/themes" element={
                <div className="space-y-4">
                  <h1 className="text-xl font-semibold text-gray-900">Themes</h1>
                  <p className="text-gray-500">Theme management coming soon.</p>
                </div>
              } />
              <Route path="/ai" element={
                <div className="space-y-4">
                  <h1 className="text-xl font-semibold text-gray-900">AI Tools</h1>
                  <p className="text-gray-500">AI tools integration coming soon.</p>
                </div>
              } />
              {/* Audit Logs - Admin only */}
              <Route
                path="/audit"
                element={
                  <ProtectedRoute requiredRole="Admin">
                    <AuditLogPage />
                  </ProtectedRoute>
                }
              />

              {/* Default redirect to dashboard */}
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
            </Route>

            {/* Catch-all */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>

          <ToastContainer
            position="top-right"
            autoClose={3000}
            hideProgressBar={false}
            newestOnTop
            closeOnClick
            rtl={false}
            pauseOnFocusLoss
            draggable
            pauseOnHover
            theme="light"
          />
        </AuthProvider>

      </QueryClientProvider>
    </BrowserRouter>
  )
}

export default App