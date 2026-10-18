import { NotificationIcon, NotificationClose } from './appearance/NotificationIcon'
import { AppearanceProvider, useAppearance } from './appearance/AppearanceProvider'
import { BrowserRouter, Routes, Route, Navigate, useMatch } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { ToastContainer } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { AdminShell } from './components/layout/AdminShell'
import Login from './pages/login/LoginPage'
import Dashboard from './pages/dashboard/DashboardPage'
import Submissions from './pages/submissions/SubmissionsPage'
import Analytics from './pages/analytics/AnalyticsPage'
import Products from './pages/products/ProductsPage'
import Domains from './pages/domains/DomainsPage'
import Users from './pages/users/UsersPage'
import { AuditLogPage } from './pages/audit'
import Forbidden from './pages/error/ForbiddenPage'
import { useAuthGuard } from './hooks/useAuthGuard'
import type { UserRole } from './types/auth'
import { queryClient } from './queryClient'
import { BillingAccountPage, BillingIndexPage } from './pages/billing/BillingAccountPage'
import { BillingLedgerBoundaryPage } from './pages/billing/BillingLedgerBoundaryPage'
import { BillingAdjustmentHistoryPage } from './pages/billing/BillingAdjustmentHistoryPage'
import { BillingSubscriptionPage } from './pages/billing/BillingSubscriptionPage'
import { AiImageJobsPage } from './pages/ai/AiImageJobsPage'
import { BillingReportsPage } from './pages/billing/BillingReportsPage'
import { BillingReconciliationPage } from './pages/billing/BillingReconciliationPage'
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

function Application() {
  const { mode } = useAppearance()
  return (
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
              <Route path="/products" element={<Products />} />
              <Route path="/domains" element={<Domains />} />
              <Route path="/domains/:domainId" element={<Domains />} />
              <Route path="/users" element={<Users />} />
              <Route path="/billing" element={<BillingIndexPage />} />
              <Route path="/billing/clients/:clientId/reports" element={<BillingReportsPage />} />
              <Route path="/billing/clients/:clientId/reports/anomalies/:evaluationId" element={<BillingReportsPage />} />
              <Route path="/billing/clients/:clientId/reconciliation" element={<BillingReconciliationPage />} />
              <Route path="/billing/clients/:clientId/account" element={<BillingAccountPage />} />
              <Route path="/billing/clients/:clientId/ledger" element={<BillingLedgerBoundaryPage />} />
              <Route path="/billing/clients/:clientId/adjustments" element={<BillingAdjustmentHistoryPage />} />
              <Route path="/billing/clients/:clientId/subscriptions" element={<BillingSubscriptionPage />} />

              <Route path="/ai" element={<AiImageJobsPage />} />
              <Route path="/ai/image-jobs/:jobId" element={<AiImageJobsPage />} />
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
            icon={NotificationIcon}
            closeButton={NotificationClose}
            position="top-right"
            autoClose={3000}
            hideProgressBar={false}
            newestOnTop
            closeOnClick
            rtl={false}
            pauseOnFocusLoss
            draggable
            pauseOnHover
            theme={mode}
          />
        </AuthProvider>

      </QueryClientProvider>
  )
}

function SessionAppearance() {
  const isLogin = !!useMatch('/login')
  const { user, isAuthenticated, isInitialized, accessToken } = useAuth()
  // Match the existing auth restoration policy without making appearance an
  // authority for access. Login always stays on System, including submit/restore.
  const restoringUser = !isInitialized && !!accessToken
  const userId = !isLogin && (isAuthenticated || restoringUser) ? user?.id || null : null
  return <AppearanceProvider userId={userId}><Application /></AppearanceProvider>
}

export default function App() {
  return <BrowserRouter><SessionAppearance /></BrowserRouter>
}
