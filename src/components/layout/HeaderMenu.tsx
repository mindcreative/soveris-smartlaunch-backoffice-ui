import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

interface HeaderMenuProps {
  label: string
  trigger: ReactNode
  children: ReactNode
  open: boolean
  onOpenChange: (open: boolean) => void
  tooltip?: string
}
/** APG menu-button: roving focus, wrapping arrows, Home/End, typeahead,
 * Escape/activation return focus; Tab exits to normal document navigation. */
export function HeaderMenu({ label, trigger, children, open, onOpenChange, tooltip }: HeaderMenuProps) {
  const id = useId(), triggerRef = useRef<HTMLButtonElement>(null), rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null), startAtEnd = useRef(false)
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false)
  const [tooltipDismissed, setTooltipDismissed] = useState(false)
  const showTooltip = !!tooltip && !open && !tooltipDismissed && (hovered || focused)
  const items = () => [...(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])]
  useLayoutEffect(() => {
    if (!open) return
    const fit = () => {
      const menu = menuRef.current
      if (!menu) return
      const viewport = window.visualViewport
      const bottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight
      menu.style.maxHeight = `${Math.max(0, bottom - menu.getBoundingClientRect().top - 8)}px`
    }
    fit()
    const list = items()
    const firstItem = startAtEnd.current ? list[list.length - 1] : list[0]
    firstItem?.focus()
    startAtEnd.current = false
    window.addEventListener('resize', fit)
    window.addEventListener('scroll', fit, { passive: true })
    window.visualViewport?.addEventListener('resize', fit)
    window.visualViewport?.addEventListener('scroll', fit)
    return () => {
      window.removeEventListener('resize', fit)
      window.removeEventListener('scroll', fit)
      window.visualViewport?.removeEventListener('resize', fit)
      window.visualViewport?.removeEventListener('scroll', fit)
    }
  }, [open])
  useEffect(() => {
    if (!showTooltip) return
    const dismiss = (event: KeyboardEvent) => { if (event.key === 'Escape') setTooltipDismissed(true) }
    document.addEventListener('keydown', dismiss)
    return () => document.removeEventListener('keydown', dismiss)
  }, [showTooltip])
  useEffect(() => {
    if (!open) return
    const outside = (event: Event) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) onOpenChange(false)
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', outside)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside) }
  }, [open, onOpenChange])
  return <div ref={rootRef} className="relative min-w-0"
    onMouseEnter={() => { setHovered(true); setTooltipDismissed(false) }} onMouseLeave={() => setHovered(false)}>
    <button ref={triggerRef} type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open}
      aria-controls={open ? id : undefined} className="header-menu-trigger"
      onFocus={() => { setFocused(true); setTooltipDismissed(false) }} onBlur={() => setFocused(false)}
      onClick={() => onOpenChange(!open)} onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); startAtEnd.current = event.key === 'ArrowUp'; onOpenChange(true)
        }
      }}>
      {trigger}
    </button>
    {showTooltip && <span aria-hidden="true" className="header-tooltip"><span className="header-tooltip-content">{tooltip}</span></span>}
    {open && <div ref={menuRef} id={id} role="menu" aria-label={label === 'Appearance' ? label : 'User menu'} className="header-menu"
      onClick={event => {
        if ((event.target as HTMLElement).closest('[role^="menuitem"]')) { triggerRef.current?.focus(); onOpenChange(false) }
      }} onKeyDown={event => {
        const list = items(), index = list.indexOf(document.activeElement as HTMLElement)
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); triggerRef.current?.focus(); onOpenChange(false) }
        else if (event.key === 'Tab') { triggerRef.current?.focus(); onOpenChange(false) }
        else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault()
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length
          list[next]?.focus()
        } else if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.altKey && !event.metaKey) {
          const ordered = [...list.slice(index + 1), ...list.slice(0, index + 1)]
          ordered.find(item => item.textContent?.trim().toLowerCase().startsWith(event.key.toLowerCase()))?.focus()
        }
      }}>{children}</div>}
  </div>
}
