import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

export interface NotificationItem {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  title: string
  message: string
  duration?: number
  createdAt: number
}

interface UiState {
  sidebarCollapsed: boolean
  activeRoute: string
  notifications: NotificationItem[]
  isLoading: boolean
}

interface UiActions {
  toggleSidebar: () => void
  setSidebarCollapsed: (collapsed: boolean) => void
  setActiveRoute: (route: string) => void
  addNotification: (notification: Omit<NotificationItem, 'id' | 'createdAt'>) => void
  removeNotification: (id: string) => void
  clearNotifications: () => void
  setLoading: (loading: boolean) => void
}

type UiStore = UiState & UiActions

export const useUiStore = create<UiStore>()(
  devtools(
    persist(
      (set, get) => ({
        sidebarCollapsed: false,
        activeRoute: '/dashboard',
        notifications: [],
        isLoading: false,

        toggleSidebar: () => {
          set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed }))
        },

        setSidebarCollapsed: (collapsed) => {
          set({ sidebarCollapsed: collapsed })
        },

        setActiveRoute: (route) => {
          set({ activeRoute: route })
        },

        addNotification: (notification) => {
          const id = crypto.randomUUID()
          const createdAt = Date.now()
          const fullNotification = { ...notification, id, createdAt }
          
          set((state) => ({
            notifications: [...state.notifications, fullNotification],
          }))

          // Auto-dismiss if duration is set
          if (notification.duration != null && notification.duration > 0) {
            setTimeout(() => {
              get().removeNotification(id)
            }, notification.duration)
          }
        },

        removeNotification: (id) => {
          set((state) => ({
            notifications: state.notifications.filter((n) => n.id !== id),
          }))
        },

        clearNotifications: () => {
          set({ notifications: [] })
        },

        setLoading: (loading) => {
          set({ isLoading: loading })
        },
      }),
      {
        name: 'backoffice-ui-persist',
        partialize: (state) => ({
          sidebarCollapsed: state.sidebarCollapsed,
          activeRoute: state.activeRoute,
        }),
      }
    ),
    { name: 'BackofficeUiStore' }
  )
)