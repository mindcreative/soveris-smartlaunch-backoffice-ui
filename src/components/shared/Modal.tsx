import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  footer?: React.ReactNode
  closeOnBackdropClick?: boolean
  closeDisabled?: boolean
  closeLabel?: string
  descriptionId?: string
  initialFocusRef?: React.RefObject<HTMLElement | null>
}

const sizeMap: Record<string, string> = {
  sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-xl',
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true')
}

export function Modal({
  isOpen, onClose, title, children, size = 'md', footer, closeOnBackdropClick = true,
  closeDisabled = false, closeLabel = 'Close dialog', descriptionId, initialFocusRef,
}: ModalProps) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const portalRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLElement | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  if (!portalRef.current && typeof document !== 'undefined') {
    portalRef.current = document.createElement('div')
    portalRef.current.dataset.modalPortal = 'true'
  }

  useEffect(() => {
    if (!isOpen || !portalRef.current) return
    const portal = portalRef.current
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.body.appendChild(portal)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const backgrounds = [...document.body.children].filter((element) => element !== portal) as HTMLElement[]
    const previous = backgrounds.map((element) => ({
      element, inert: element.inert, ariaHidden: element.getAttribute('aria-hidden'),
    }))
    for (const element of backgrounds) {
      element.inert = true
      element.setAttribute('aria-hidden', 'true')
    }
    const frame = requestAnimationFrame(() => {
      const preferred = initialFocusRef?.current ??
        dialogRef.current?.querySelector<HTMLElement>('[data-modal-initial-focus]') ?? closeRef.current
      preferred?.focus()
    })
    return () => {
      cancelAnimationFrame(frame)
      document.body.style.overflow = previousOverflow
      for (const state of previous) {
        state.element.inert = state.inert
        if (state.ariaHidden === null) state.element.removeAttribute('aria-hidden')
        else state.element.setAttribute('aria-hidden', state.ariaHidden)
      }
      portal.remove()
      const trigger = triggerRef.current
      requestAnimationFrame(() => { if (trigger?.isConnected) trigger.focus() })
    }
  }, [initialFocusRef, isOpen])

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!closeDisabled) { event.preventDefault(); onClose() }
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const elements = focusableElements(dialogRef.current)
      if (elements.length === 0) { event.preventDefault(); dialogRef.current.focus(); return }
      const first = elements[0]!
      const last = elements[elements.length - 1]!
      if (!dialogRef.current.contains(document.activeElement)) { event.preventDefault(); first.focus() }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeDisabled, isOpen, onClose])

  if (!isOpen || !portalRef.current) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(event) => {
        if (closeOnBackdropClick && !closeDisabled && event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : 'Dialog'} aria-describedby={descriptionId} tabIndex={-1}
        className={`flex max-h-[90vh] w-full min-w-0 flex-col rounded-lg bg-white shadow-xl ${sizeMap[size]}`}
      >
        <div className="flex items-center justify-between gap-4 border-b border-gray-200 px-4 py-3 sm:px-6 sm:py-4">
          {title ? <h2 id={titleId} className="min-w-0 text-lg font-semibold text-gray-950">{title}</h2> : <span />}
          <button
            ref={closeRef} type="button" onClick={onClose} disabled={closeDisabled} aria-label={closeLabel}
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md text-gray-600 hover:bg-gray-100 hover:text-gray-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:cursor-wait disabled:opacity-50"
          >
            <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">{children}</div>
        {footer && <div className="border-t border-gray-200 px-4 py-4 sm:px-6">{footer}</div>}
      </div>
    </div>, portalRef.current
  )
}
