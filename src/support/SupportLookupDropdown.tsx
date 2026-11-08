import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { SUPPORT_BUTTON_CLASS, SUPPORT_INPUT_CLASS } from './constants'

type LookupOption = { id: string; label: string; selected: boolean; disabled: boolean }
type DropdownProps = {
  label: string
  value: string
  disabled: boolean
  busy: boolean
  options: LookupOption[]
  status: ReactNode
  more: boolean
  page: number
  select: (id: string) => void
  loadMore: () => void
  start: () => void
  dismiss: () => void
  resume: () => void
  multiple?: boolean
  invalid?: boolean
  errorId?: string
}

/** Non-editable listbox with virtual focus; paging controls are siblings of its options. */
export function SupportLookupDropdown(props: DropdownProps) {
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const previousPage = useRef(0)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState<string | null>(null)
  const activeIndex = props.options.findIndex(option => option.id === active && !option.disabled)
  const optionId = (index: number) => `${id}-option-${index}`
  const pageIdentity = props.options.map(option => option.id).join(',')

  function close(returnFocus = false): void {
    setOpen(false)
    setActive(null)
    props.dismiss()
    previousPage.current = 0

    if (returnFocus) {
      trigger.current?.focus()
    }
  }

  function expand(): void {
    if (!props.disabled) {
      props.resume()
      setOpen(true)
    }
  }

  useEffect(() => {
    if (open && !props.disabled && !props.busy) {
      const paged = previousPage.current !== 0 && previousPage.current !== props.page
      const option = (!paged ? props.options.find(option => option.selected && !option.disabled) : null) ?? props.options.find(option => !option.disabled)
      setActive(option?.id ?? null)
      previousPage.current = props.page
      list.current?.focus()
    }
  }, [open, props.disabled, props.busy, pageIdentity, props.page])

  useEffect(() => {
    if (!open) {
      return
    }

    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        close()
      }
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open, props.dismiss])

  function choose(option: LookupOption): void {
    if (props.disabled || props.busy || option.disabled) {
      return
    }

    props.select(option.id)

    if (props.multiple) {
      list.current?.focus()
    } else {
      close(true)
    }
  }

  function navigate(event: KeyboardEvent<HTMLDivElement>): void {
    const available = props.options.filter(option => !option.disabled)
    const previous = available.findIndex(option => option.id === active)
    const moves = ['ArrowDown', 'ArrowUp', 'Home', 'End']

    if (moves.includes(event.key)) {
      event.preventDefault()
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? available.length - 1
        : event.key === 'ArrowDown' ? (previous + 1) % available.length : previous <= 0 ? available.length - 1 : previous - 1
      const option = available[next]
      setActive(option?.id ?? null)

      if (option) {
        document.getElementById(optionId(props.options.indexOf(option)))?.scrollIntoView?.({ block: 'nearest' })
      }
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const option = props.options[activeIndex]

      if (option) {
        choose(option)
      }
    }
  }

  return <div ref={root} className="relative min-w-0 space-y-2" onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) {
      close()
    }
  }} onKeyDown={event => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      event.stopPropagation()
      close(true)
    } else if (event.key === 'Tab' && open) {
      const control = root.current
      window.setTimeout(() => {
        if (control && root.current === control && !control.contains(document.activeElement)) {
          close()
        }
      }, 0)
    }
  }}>
    <label id={`${id}-label`} className="block font-semibold">{props.label}</label>
    <button ref={trigger} type="button" role="combobox" aria-labelledby={`${id}-label`} aria-describedby={`${id}-status${props.errorId ? ' ' + props.errorId : ''}`}
      aria-invalid={props.invalid || undefined} aria-expanded={open} aria-controls={`${id}-list`} aria-haspopup="listbox" disabled={props.disabled}
      className={`${SUPPORT_INPUT_CLASS} flex items-center justify-between gap-3 text-left disabled:cursor-not-allowed disabled:opacity-50`}
      onClick={() => open ? close() : expand()} onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          expand()
        }
      }}>
      <span className="min-w-0 break-words">{props.value}</span><ChevronDown aria-hidden="true" className="size-4 shrink-0" />
    </button>
    {open && <div className="absolute inset-x-0 z-20 max-h-[min(28rem,60dvh)] space-y-3 overflow-y-auto rounded-lg border border-control bg-surface p-3 shadow-lg">
      <div id={`${id}-status`} role="status" className="space-y-2">{props.status}
        {!props.busy && props.options.length > 0 && <p>Page {props.page} · {props.options[0]!.label}</p>}
      </div>
      <div ref={list} id={`${id}-list`} role="listbox" tabIndex={0} aria-label={`Available ${props.label.toLowerCase()}`}
        aria-multiselectable={props.multiple || undefined} aria-busy={props.busy}
        aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined} onKeyDown={navigate}
        className="max-h-64 overflow-y-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
        {props.options.map((option, index) => <div key={option.id} id={optionId(index)} role="option" aria-selected={option.selected}
          aria-disabled={option.disabled || props.disabled || props.busy} onPointerMove={() => setActive(option.disabled ? null : option.id)}
          onClick={() => choose(option)} className={`flex min-h-11 cursor-pointer items-center gap-2 break-words rounded px-3 py-2 ${active === option.id ? 'bg-subtle ring-2 ring-inset ring-focus' : ''} ${option.disabled ? 'cursor-not-allowed opacity-50' : ''}`}>
          {props.multiple && <span aria-hidden="true">{option.selected ? '☑' : '☐'}</span>}<span className="min-w-0 break-words">{option.label}</span>
        </div>)}
      </div>
      <div className="flex flex-wrap gap-2">
        {props.page > 1 && <button type="button" className={SUPPORT_BUTTON_CLASS} disabled={props.disabled || props.busy} onClick={props.start}>Start of list</button>}
        {props.more ? <button type="button" className={SUPPORT_BUTTON_CLASS} disabled={props.disabled || props.busy} onClick={props.loadMore}>Next options</button>
          : !props.busy && props.options.length > 0 && <p>End of available options</p>}
      </div>
    </div>}
    {!open && <div id={`${id}-status`} role="status" className="space-y-2">{props.status}</div>}
  </div>
}
