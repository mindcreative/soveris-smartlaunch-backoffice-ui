import { useAuthStore } from '../stores/authStore'
import { parseLocalInstant } from './LocalInstant'

export async function localResponseBinding(_signal?: AbortSignal) {
  const actorId = useAuthStore.getState().user?.id
  if (!actorId) throw new Error('Authenticated user is unavailable')
  return {
    instant: parseLocalInstant,
    verify: (_headers: Record<string, unknown> | undefined): void => {
      if (useAuthStore.getState().user?.id !== actorId)
        throw new Error('Authenticated user changed during response load')
    },
  }
}
