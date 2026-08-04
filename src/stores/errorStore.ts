import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

export interface ApiError {
  code: string
  message: string
  status?: number
  timestamp?: string
}

interface ErrorState {
  lastError: ApiError | null
  errorHistory: ApiError[]
  isShowingToast: boolean
}

interface ErrorActions {
  setError: (error: ApiError) => void
  clearError: () => void
  getLastError: () => ApiError | null
}

type ErrorStore = ErrorState & ErrorActions

const MAX_HISTORY = 50

export const useErrorStore = create<ErrorStore>()(
  devtools(
    persist(
      (set, get) => ({
        lastError: null,
        errorHistory: [],
        isShowingToast: false,

        setError: (error: ApiError) => {
          const state = get()
          const newHistory = [error, ...state.errorHistory].slice(0, MAX_HISTORY)
          set({
            lastError: error,
            errorHistory: newHistory,
            isShowingToast: true,
          })
        },

        clearError: () => {
          set({
            lastError: null,
            isShowingToast: false,
          })
        },

        getLastError: () => {
          return get().lastError
        },
      }),
      {
        name: 'backoffice-error-persist',
        partialize: (state) => ({
          lastError: state.lastError,
        }),
      }
    ),
    { name: 'BackofficeErrorStore' }
  )
)