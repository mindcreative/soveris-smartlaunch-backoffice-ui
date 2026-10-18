import { useEffect, useState, type RefObject } from 'react'
import { useLocation } from 'react-router-dom'
import { Check, ChevronDown, LogOut, Menu, Monitor, Moon, Sun } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useAppearance } from '../../appearance/AppearanceProvider'
import { HeaderMenu } from './HeaderMenu'
import { PageContext } from './PageContext'

interface TopBarProps {
  onOpenMobileNavigation: () => void
  menuButtonRef: RefObject<HTMLButtonElement | null>
}
const choices = [{ value: 'system', label: 'System', Icon: Monitor }, { value: 'light', label: 'Light', Icon: Sun }, { value: 'dark', label: 'Dark', Icon: Moon }] as const

export function TopBar({ onOpenMobileNavigation, menuButtonRef }: TopBarProps) {
  const { user, logout } = useAuth(), appearance = useAppearance(), location = useLocation()
  const [open, setOpen] = useState<'appearance' | 'user' | null>(null)
  useEffect(() => { setOpen(null) }, [location.key, user?.id, user?.clientId, user?.role])
  const name = user?.displayName?.trim() || user?.email || 'User'
  const initials = name.split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join('').toUpperCase()
  const AppearanceIcon = choices.find(choice => choice.value === appearance.preference)!.Icon
  return <header className="relative lg:sticky top-0 z-40 border-b border-line bg-surface">
    <div className="flex min-h-16 min-w-0 flex-wrap items-center justify-between gap-2 px-3 py-2 sm:flex-nowrap sm:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <button ref={menuButtonRef} type="button" onClick={onOpenMobileNavigation} aria-label="Open navigation" title="Open navigation"
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus lg:hidden">
          <Menu aria-hidden="true" size={20} />
        </button>
        <PageContext />
      </div>
      <div className="flex shrink-0 items-center justify-end gap-1 sm:gap-2">
        <HeaderMenu label="Appearance" tooltip="Appearance" open={open === 'appearance'} onOpenChange={value => setOpen(current => value ? 'appearance' : current === 'appearance' ? null : current)} trigger={<AppearanceIcon aria-hidden="true" size={20} />}>
          <p className="px-3 py-2 text-xs font-semibold text-muted" role="presentation">Appearance</p>
          {choices.map(({ value, label, Icon }) => <button key={value} role="menuitemradio" aria-checked={appearance.preference === value} tabIndex={-1} type="button" className="header-menu-item" onClick={() => appearance.setPreference(value)}>
            <Icon aria-hidden="true" size={18} /><span className="flex-1">{label}</span>{appearance.preference === value && <Check aria-hidden="true" size={18} />}
          </button>)}
        </HeaderMenu>
        <HeaderMenu label={`User menu: ${name}`} tooltip="User menu" open={open === 'user'} onOpenChange={value => setOpen(current => value ? 'user' : current === 'user' ? null : current)} trigger={<>
          <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-selected text-sm font-semibold text-primary">{initials}</span>
          <span className="hidden max-w-44 truncate text-sm font-medium sm:block">{name}</span><ChevronDown aria-hidden="true" size={16} className="hidden sm:block" />
        </>}>
          <div role="presentation" className="break-words border-b border-line px-3 py-3 text-sm">
            <p className="font-semibold">{name}</p><p className="mt-1 text-muted">{user?.email}</p><p className="mt-1 text-muted">{user?.role}</p>
          </div>
          <button type="button" role="menuitem" tabIndex={-1} className="header-menu-item" onClick={() => { setOpen(null); void logout() }}><LogOut aria-hidden="true" size={18} />Logout</button>
        </HeaderMenu>
      </div>
    </div>
    {appearance.saveFailed && <p role="status" className="border-t border-warning-line bg-warning-soft px-4 py-2 text-sm text-warning">Appearance changed for this session, but could not be saved in this browser.</p>}
  </header>
}
