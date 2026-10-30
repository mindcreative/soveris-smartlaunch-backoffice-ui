import { useLayoutEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { ACCOUNT_LINK_CLASS } from './constants/accountLifecycle'
import type { AccountLayoutProps } from './models/accountPresentation'

export function AccountLayout({ title, description, children }: AccountLayoutProps) {
  const heading = useRef<HTMLHeadingElement>(null)

  useLayoutEffect(() => {
    document.title = `${title} · SmartLaunch · Soveris`
    heading.current?.focus()
  }, [title])

  return <div className="min-h-dvh bg-app px-4 py-8 text-foreground sm:px-6 [padding-bottom:max(2rem,env(safe-area-inset-bottom))]">
    <div className="mx-auto w-full max-w-sm">
      <main className="rounded-2xl border border-line bg-surface px-5 py-8 shadow-sm sm:px-8">
        <div className="mx-auto mb-4 w-36" role="img" aria-label="Soveris">
          <img src="/soveris-light.svg" alt="" className="brand-light h-auto w-full" />
          <img src="/soveris-dark.svg" alt="" className="brand-dark h-auto w-full" />
        </div>
        <p className="mb-4 text-center text-sm font-medium text-muted">SmartLaunch</p>
        <h1 ref={heading} tabIndex={-1} className="break-words text-2xl font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-focus">{title}</h1>
        {description && <p className="mt-2 text-sm text-muted">{description}</p>}
        <div className="mt-6 space-y-5">{children}</div>
        <nav aria-label="Account" className="mt-6 flex flex-wrap justify-between gap-3 border-t border-line pt-3">
          <Link to="/signup" className={ACCOUNT_LINK_CLASS}>Create account</Link>
          <Link to="/login" className={ACCOUNT_LINK_CLASS}>Log in</Link>
        </nav>
      </main>
      <footer className="mt-6 text-center text-xs text-muted">© {new Date().getFullYear()} Soveris SmartLaunch. All rights reserved.</footer>
    </div>
  </div>
}
