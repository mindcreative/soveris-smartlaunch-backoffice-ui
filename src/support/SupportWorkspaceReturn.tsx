import { useNavigate } from 'react-router-dom'
import { workspaceDestinations } from '../auth/experience'
import { useAuthStore } from '../stores/authStore'
import { supportText } from './labels'

export function SupportWorkspaceReturn() {
  const actor = useAuthStore(state => state.user)
  const navigate = useNavigate()
  const destination = workspaceDestinations.find(([, , permission]) => actor?.permissions?.includes(permission))?.[0] ?? 'workspace-access'
  return <button type="button" className="min-h-11 max-w-full break-words text-left text-primary underline" onClick={() => {
    navigate('/' + destination)
    window.setTimeout(() => {
      const heading = document.querySelector<HTMLElement>('#main-content h1')
      heading?.setAttribute('tabindex', '-1')
      heading?.focus()
    }, 0)
  }}>Return to {supportText(actor?.workspaceName, 'your workspace')}</button>
}
