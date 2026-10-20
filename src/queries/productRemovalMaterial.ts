import { useAuthStore } from '../stores/authStore'
import { removalPolicy, type RemovalCommand } from '../api/productRemovalContracts'

const prefix = 'backoffice:product-removal:'
const memory = new Map<string, string>()
function identity() {
  const state = useAuthStore.getState()
  return JSON.stringify([state.user?.id,state.user?.clientId,state.user?.clientRoleId,state.user?.sessionId,state.user?.securityRevision,state.user?.role,state.user?.permissions,state.accessToken])
}

export function clearRemovalMaterial() {
  memory.clear()
  try {
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith(prefix)) sessionStorage.removeItem(key)
    }
  } catch { /* Retained server lookup remains available. */ }
}

let current = identity()
useAuthStore.subscribe((state,previous) => {
  // A cold restore has no established identity yet. Stored commands remain unreadable
  // until the server verifies the original session; login/revocation cannot revive them.
  if(!state.isInitialized || state.isLoading) return
  if(!state.isAuthenticated) {current=identity();clearRemovalMaterial();return}
  if(previous.isAuthenticated && previous.accessToken!==state.accessToken) clearRemovalMaterial()
  const next=identity()
  if(next!==current) {
    current=next
    const keys=new Set(memory.keys())
    try {for(const storageKey of Object.keys(sessionStorage)) keys.add(storageKey)} catch { /* Memory only. */ }
    for(const storageKey of keys) {
      if(!storageKey.startsWith(prefix)) continue
      const [client,product,operation,extra]=storageKey.slice(prefix.length).split(':')
      if(client && product && operation && extra===undefined && readRemovalMaterial(client,product,operation)) continue
      memory.delete(storageKey)
      try {sessionStorage.removeItem(storageKey)} catch { /* Memory removed. */ }
    }
  }
})
if (typeof window !== 'undefined') {
  window.addEventListener('auth:cleared', clearRemovalMaterial)
  window.addEventListener('auth:refreshed', clearRemovalMaterial)
}

function key(client: string, product: string, operation: string) {
  return `${prefix}${client}:${product}:${operation}`
}

export function rememberRemovalMaterial(client: string, product: string, command: RemovalCommand) {
  const user = useAuthStore.getState().user
  if (!useAuthStore.getState().isAuthenticated || !user || user.clientId !== client || !user.sessionId || !user.clientRoleId || !user.securityRevision || !user.permissions?.includes('products:delete')) return
  const storageKey = key(client, product, command.operationId)
  const value = JSON.stringify({ actor:user.id,role:user.role,session:user.sessionId,revision:user.securityRevision,clientRole:user.clientRoleId,command })
  memory.set(storageKey, value)
  try { sessionStorage.setItem(storageKey, value) }
  catch { /* Closing the modal must not discard this tab's exact command. */ }
}

export function forgetRemovalMaterial(client: string, product: string, operation: string) {
  const storageKey = key(client, product, operation)
  memory.delete(storageKey)
  try { sessionStorage.removeItem(storageKey) }
  catch { /* No storage. */ }
}

export function readRemovalMaterial(client: string, product: string, operation: string): RemovalCommand | null {
  const storageKey = key(client, product, operation)
  let value = memory.get(storageKey) ?? null
  try { value = sessionStorage.getItem(storageKey) ?? value }
  catch { /* Use the in-memory command if storage is unavailable. */ }
  try {
    const user = useAuthStore.getState().user
    const stored = JSON.parse(value ?? 'null') as { actor?: string; role?: string; session?:string; revision?:string; clientRole?:string; command?: RemovalCommand } | null
    const command = stored?.command
    if (!useAuthStore.getState().isAuthenticated || !user || !user.sessionId || !user.permissions?.includes('products:delete') ||
        user.clientId !== client || stored?.actor !== user.id || stored.role !== user.role ||
        stored.session!==user.sessionId || stored.revision!==user.securityRevision || stored.clientRole!==user.clientRoleId ||
        !command || command.operationId !== operation || command.policyVersion !== removalPolicy ||
        typeof command.expectedRevision !== 'string' || !/^[1-9]\d*$/.test(command.expectedRevision) ||
        BigInt(command.expectedRevision) > 9223372036854775807n || !/^[a-f0-9]{64}$/.test(command.previewFingerprint)) return null
    return { operationId: operation, expectedRevision: command.expectedRevision, policyVersion: removalPolicy, previewFingerprint: command.previewFingerprint }
  } catch { return null }
}

// Navigation can drop the URL query. Discover only this actor's scoped, validated
// outstanding commands; a storage failure still leaves the current tab's copies.
export function outstandingRemovalLocators(): Array<{ productId: string; operationId: string }> {
  const client = useAuthStore.getState().user?.clientId
  if (!client) return []
  const keys = new Set(memory.keys())
  try { for (const storageKey of Object.keys(sessionStorage)) keys.add(storageKey) }
  catch { /* Use in-memory outstanding requests. */ }
  const clientPrefix = `${prefix}${client}:`
  const locators: Array<{ productId: string; operationId: string }> = []
  for (const storageKey of keys) {
    if (!storageKey.startsWith(clientPrefix)) continue
    const [productId, operationId, extra] = storageKey.slice(clientPrefix.length).split(':')
    if (!productId || !operationId || extra !== undefined) continue
    if (readRemovalMaterial(client, productId, operationId)) locators.push({ productId, operationId })
  }
  return locators
}
