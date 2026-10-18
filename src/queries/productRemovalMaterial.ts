import { useAuthStore } from '../stores/authStore'
import { removalPolicy, type RemovalCommand } from '../api/productRemovalContracts'

const prefix = 'backoffice:product-removal:'
const memory = new Map<string, string>()
function identity() {
  const state = useAuthStore.getState()
  return JSON.stringify([state.user?.id, state.user?.clientId, state.user?.role, state.accessToken])
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
useAuthStore.subscribe((state, previous) => {
  const next = identity()
  if (next !== current || (previous.isAuthenticated && !state.isAuthenticated)) {
    current = next
    clearRemovalMaterial()
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
  if (!user || user.clientId !== client) return
  const storageKey = key(client, product, command.operationId)
  const value = JSON.stringify({ actor: user.id, role: user.role, command })
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
    const stored = JSON.parse(value ?? 'null') as { actor?: string; role?: string; command?: RemovalCommand } | null
    const command = stored?.command
    if (!user || user.clientId !== client || stored?.actor !== user.id || stored.role !== user.role ||
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
