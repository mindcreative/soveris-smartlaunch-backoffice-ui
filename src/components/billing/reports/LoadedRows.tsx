import { useState, type ReactNode } from 'react'
// Bound DOM work while keeping every loaded row reachable in server order.
// These controls inspect retained data; they never issue offset/page requests.
export function LoadedRows<T>({items,unit,children}:{items:T[];unit:string;children:(visible:T[])=>ReactNode}) {
  const [position,setPosition]=useState(0),last=Math.max(0,Math.ceil(items.length/100)-1)
  const current=Math.min(position,last),start=current*100,visible=items.slice(start,start+100)
  return <div><p>Showing loaded {unit} {items.length?start+1:0}–{start+visible.length} of {items.length} loaded.</p>{items.length>100&&<div className="flex flex-wrap gap-3"><button type="button" disabled={current===0} onClick={()=>setPosition(current-1)}>Earlier loaded {unit}</button><button type="button" disabled={current===last} onClick={()=>setPosition(current+1)}>Later loaded {unit}</button></div>}{children(visible)}</div>
}
