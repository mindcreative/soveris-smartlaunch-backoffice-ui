// Untrusted presentation hint only. No caller may use this value as identity,
// membership or authority; /auth/current must still verify every restored session.
export function appearanceSubject(token: unknown, nowSeconds = Date.now()/1000): string | null {
  if(typeof token!=='string' || token.length>8192)return null
  const segments=token.split('.')
  if(segments.length!==3 || segments.some(p=>!p || !/^[A-Za-z0-9_-]+$/.test(p)) || segments[1].length>4096)return null
  try {
    const payload=JSON.parse(atob(segments[1].replace(/-/g,'+').replace(/_/g,'/')))
    return payload && typeof payload.sub==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.sub) &&
      typeof payload.exp==='number' && Number.isSafeInteger(payload.exp) && payload.exp>nowSeconds ? payload.sub.toLowerCase() : null
  }catch{return null}
}
export function pendingAppearanceSubject(access:unknown,refresh:unknown):string|null {
  try {
    if(typeof refresh!=='string' || !refresh || localStorage.getItem('backoffice_access_token')!==access || localStorage.getItem('backoffice_refresh_token')!==refresh)return null
    return appearanceSubject(access)
  }catch{return null}
}
