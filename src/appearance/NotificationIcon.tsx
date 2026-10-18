import { CircleCheck, CircleAlert, Info, TriangleAlert, X } from 'lucide-react'
import type { CloseButtonProps, IconProps } from 'react-toastify'
export function NotificationIcon({ type }: IconProps) {
  const Icon = type === 'success' ? CircleCheck : type === 'error' ? CircleAlert : type === 'warning' ? TriangleAlert : Info
  const color = type === 'success' ? 'text-success' : type === 'error' ? 'text-danger' : type === 'warning' ? 'text-warning' : 'text-info'
  return <Icon aria-hidden="true" size={20} className={color} />
}
export function NotificationClose({ closeToast }: CloseButtonProps) {
  return <button type="button" className="Toastify__close-button" aria-label="Close notification" title="Close notification" onClick={closeToast}><X aria-hidden="true" size={18} /></button>
}
