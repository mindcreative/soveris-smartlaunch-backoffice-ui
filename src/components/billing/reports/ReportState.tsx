import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { LoadingSpinner } from '../../shared/LoadingSpinner'
import type { useFrozenReport } from '../../../queries/billingReportQueries'
import type { ReportKind } from '../../../types/billingReports'

export function ReportState({kind,report,refreshButtonRef}:{kind:ReportKind;report:ReturnType<typeof useFrozenReport>;refreshButtonRef?:RefObject<HTMLButtonElement|null>}) {
  const id=useId(),end=useRef<HTMLParagraphElement>(null),recovery=useRef<HTMLDivElement>(null)
  const continuation=useRef<HTMLButtonElement>(null),requested=useRef(false),continuationFocused=useRef(false)
  const staleStatus=useRef<HTMLParagraphElement>(null)
  const [now,setNow]=useState(Date.now())
  const cooldown=(report.error?.retryAt??0)>now
  const canContinue=Boolean(report.page?.nextCursor&&!report.stale&&(!report.error||report.error.kind==='transient'))
  useEffect(()=>{
    if(report.error?.retryAt){
      const timer=setTimeout(()=>setNow(Date.now()),Math.max(0,report.error.retryAt-Date.now()))
      return ()=>clearTimeout(timer)
    }
  },[report.error?.retryAt])
  useLayoutEffect(()=>{
    if(!requested.current&&!continuationFocused.current)return
    if(report.busy&&!report.stale)return
    requested.current=false
    // Preserve deliberate focus movement while the request was pending.
    if(document.activeElement!==document.body&&document.activeElement!==continuation.current)return
    if(canContinue&&!cooldown){
      continuation.current?.focus()
      continuationFocused.current=document.activeElement===continuation.current
    }else{
      continuationFocused.current=false
      if(report.error)recovery.current?.focus()
      else if(report.stale&&report.page)staleStatus.current?.focus()
      else if(report.page&&!report.page.nextCursor)end.current?.focus()
    }
  },[report.busy,report.page,report.error,report.stale,canContinue,cooldown])
  const more=()=>{
    if(report.busy||cooldown)return
    requested.current=true
    void report.more()
  }
  return <div className="space-y-3">
    <div className="sr-only" aria-live="polite" aria-atomic="true">{report.announcement}</div>
    {report.busy&&<LoadingSpinner message={`Loading ${kind==='credit'?'credit activity':'provider expense'}…`}/>}
    {report.error&&<div ref={recovery} tabIndex={-1} role="status" aria-label={`${kind==='credit'?'Credit':'Expense'} report recovery`} className="state-indicator">
      <p>{report.error.message}</p>
      <p>This read changes no credits or provider evidence. The transport may not have reached the server.</p>
      {cooldown&&<p>Retry is delayed to respect rate limiting.</p>}
      {report.page&&report.stale&&<button type="button" disabled={report.busy||cooldown} onClick={()=>{refreshButtonRef?.current?.focus();void report.refresh()}}>Refresh report</button>}
      {!report.page&&report.error.kind!=='invalid'&&<button type="button" disabled={report.busy||cooldown} onClick={()=>{refreshButtonRef?.current?.focus();void report.refresh()}}>Try again</button>}
    </div>}
    {report.stale&&report.page&&<p ref={staleStatus} tabIndex={-1} role="status" aria-label={`${kind==='credit'?'Credit':'Expense'} report continuation unavailable`} className="state-indicator">Stale snapshot — continuation is unavailable. Use Refresh report to start a new snapshot.</p>}
    {report.page&&<p id={id}>{report.page.items.length} {kind==='credit'?'periods':'groups'} loaded; {report.stale?'continuation unavailable':report.page.nextCursor?'more available':'end of results'}. Totals cover the full window.</p>}
    {canContinue&&<button ref={continuation} type="button" onFocus={()=>{continuationFocused.current=true}} onBlur={()=>{continuationFocused.current=false}} aria-disabled={report.busy||cooldown} aria-describedby={id} onClick={more}>{report.busy?'Loading more…':report.error?'Retry loading more':'Load more'}</button>}
    {report.page&&!report.page.nextCursor&&<p ref={end} tabIndex={-1} role="status" className="state-indicator">End of {kind==='credit'?'credit activity':'provider expense'} results.</p>}
  </div>
}
