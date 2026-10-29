import { pendingAppearanceSubject } from './appearance/sessionHint'
import { NotificationIcon, NotificationClose } from './appearance/NotificationIcon'
import { AppearanceProvider, useAppearance } from './appearance/AppearanceProvider'
import { BrowserRouter, Routes, Route, Navigate, useMatch } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { ToastContainer } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { AdminShell } from './components/layout/AdminShell'
import Login from './pages/login/LoginPage'
import Signup from './pages/account/SignupPage'
import CheckEmail from './pages/account/CheckEmailPage'
import VerifyEmail from './pages/account/VerifyEmailPage'
import ForgotPassword from './pages/account/ForgotPasswordPage'
import ResetPassword from './pages/account/ResetPasswordPage'
import GoogleComplete from './pages/account/GoogleCompletePage'
import GoogleLink from './pages/account/GoogleLinkPage'
import { AccountBoundary } from './account/AccountBoundary'
import { AccountFlowLifetime } from './account/AccountFlowLifetime'
import { ACCOUNT_ROUTES } from './account/constants/accountLifecycle'
import Dashboard from './pages/dashboard/DashboardPage'
import Submissions from './pages/submissions/SubmissionsPage'
import Analytics from './pages/analytics/AnalyticsPage'
import Products from './pages/products/ProductsPage'
import Domains from './pages/domains/DomainsPage'
import Users from './pages/users/UsersPage'
import { AuditLogPage } from './pages/audit'
import Forbidden from './pages/error/ForbiddenPage'
import { useAuthGuard } from './hooks/useAuthGuard'
import { queryClient } from './queryClient'
import { BillingAccountPage, BillingIndexPage } from './pages/billing/BillingAccountPage'
import { BillingLedgerBoundaryPage } from './pages/billing/BillingLedgerBoundaryPage'
import { BillingAdjustmentHistoryPage } from './pages/billing/BillingAdjustmentHistoryPage'
import { BillingSubscriptionPage } from './pages/billing/BillingSubscriptionPage'
import { AiImageJobsPage } from './pages/ai/AiImageJobsPage'
import { BillingReportsPage } from './pages/billing/BillingReportsPage'
import { PlatformHealthPage } from './pages/platform/PlatformHealthPage'
import { PlatformClientPage } from './pages/platform/PlatformClientPage'
import { PlatformIndexPage, WorkspaceAccessPage, ExperienceDeniedPage } from './pages/platform/PlatformIndexPage'
import { LoadingSpinner } from './components/shared/LoadingSpinner'
import { permittedLanding } from './auth/experience'
import { BillingReconciliationPage } from './pages/billing/BillingReconciliationPage'
// Protected route wrapper with role-based access
function ProtectedRoute({
  children,
  requiredPermission,
}: {
  children: React.ReactNode
  requiredPermission?: string
}) {
  const { hasAccess } = useAuthGuard({ requiredPermission })
  if (!hasAccess()) {
    return <Navigate to="/forbidden" replace />
  }
  return <>{children}</>
}

function Landing() {
  const { user, isInitialized, isLoading, isAuthenticated } = useAuth()
  if (!isInitialized || isLoading) return <LoadingSpinner message="Restoring access…" />
  return <Navigate to={isAuthenticated ? permittedLanding(user) : '/login'} replace />
}

function Application() {
  const { mode } = useAppearance()
  return (
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AccountFlowLifetime />
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<Login />} />
            <Route element={<AccountBoundary />}>
              <Route path="/signup" element={<Signup />} />
              <Route path="/check-email" element={<CheckEmail />} />
              <Route path="/verify-email" element={<VerifyEmail />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/account/google/complete" element={<GoogleComplete />} />
            </Route>
            <Route path="/account/google/link" element={<GoogleLink />} />
            <Route path="/forbidden" element={<Forbidden />} />

            {/* Protected routes under AdminShell */}
            <Route element={<AdminShell />}>
              <Route path="/platform" element={<PlatformIndexPage />} />
              <Route path="/platform/*" element={<ExperienceDeniedPage />} />
              <Route path="/platform/clients/:clientId" element={<PlatformClientPage />} />
              <Route path="/platform/health" element={<PlatformHealthPage />} />
              <Route path="/workspace-access" element={<WorkspaceAccessPage />} />
              <Route path="/platform/clients/:clientId/account" element={<BillingAccountPage />} />
              <Route path="/platform/clients/:clientId/ledger" element={<BillingLedgerBoundaryPage />} />
              <Route path="/platform/clients/:clientId/adjustments" element={<BillingAdjustmentHistoryPage />} />
              <Route path="/platform/clients/:clientId/subscriptions" element={<BillingSubscriptionPage />} />
              <Route path="/platform/clients/:clientId/reports" element={<BillingReportsPage />} />
              <Route path="/platform/clients/:clientId/reports/anomalies/:evaluationId" element={<BillingReportsPage />} />
              <Route path="/platform/clients/:clientId/reconciliation" element={<BillingReconciliationPage />} />
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
                  <ProtectedRoute requiredPermission="audit:view">
                    <AuditLogPage />
                  </ProtectedRoute>
                }
              />

              {/* Default redirect to dashboard */}
              <Route path="/" element={<Landing />} />
            </Route>

            {/* Catch-all */}
            <Route path="*" element={<Landing />} />
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
  const accountMatch = useMatch('/:accountRoute')
  const googleMatch = useMatch('/account/google/:action')
  const isLogin = ACCOUNT_ROUTES.some(route => route === '/' + accountMatch?.params.accountRoute?.toLowerCase()) ||
    ['complete', 'link'].includes(googleMatch?.params.action?.toLowerCase() ?? '')
  const { user, isAuthenticated, isInitialized, accessToken, refreshTokenValue } = useAuth()
  // Match the existing auth restoration policy without making appearance an
  // authority for access. Login always stays on System, including submit/restore.
  const restoringUser = !isInitialized && !!accessToken
  const userId = isLogin ? null : isAuthenticated ? user?.id ?? null : restoringUser ? pendingAppearanceSubject(accessToken,refreshTokenValue) : null
  return <AppearanceProvider userId={userId}><Application /></AppearanceProvider>
}

export default function App() {
  return <BrowserRouter><SessionAppearance /></BrowserRouter>
}
