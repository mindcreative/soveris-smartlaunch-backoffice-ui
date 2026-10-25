let epoch = 0
let validatedAccessToken: string | null | undefined
const privateUrls = new Set<string>()
export function bindAuthorityToken(token: string | null): void { validatedAccessToken = token }
export function authorityTokenIsCurrent(token: string | null): boolean {
  return validatedAccessToken === undefined || (validatedAccessToken !== null && validatedAccessToken === token)
}
export function currentAuthorityEpoch(): number { return epoch }
export function retireAuthority(): number {
  epoch++
  window.dispatchEvent(new CustomEvent('auth:retired'))
  for (const url of privateUrls) URL.revokeObjectURL(url)
  privateUrls.clear()
  return epoch
}
export function privateObjectUrl(blob: Blob): string {
  const url = URL.createObjectURL(blob); privateUrls.add(url); return url
}
export function releasePrivateObjectUrl(url: string): void { privateUrls.delete(url); URL.revokeObjectURL(url) }
export class AuthorityChangedError extends Error {
  readonly code = 'AUTHORITY_CHANGED'
  constructor() { super('Session authority changed. Reload the current view.'); this.name = 'AuthorityChangedError' }
}
