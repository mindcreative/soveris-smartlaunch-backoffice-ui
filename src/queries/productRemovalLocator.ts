import { useSyncExternalStore } from 'react'
import { canonicalizeGuid } from '../lib/guid'
import { outstandingRemovalLocators } from './productRemovalMaterial'

const event = 'product-removal:locator'
const operationPattern = /^[\da-f]{8}-[\da-f]{4}-7[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/
export interface RemovalLocator { operationId: string; productId: string }

function subscribe(listener: () => void) {
  window.addEventListener(event, listener)
  window.addEventListener('popstate', listener)
  return () => {
    window.removeEventListener(event, listener)
    window.removeEventListener('popstate', listener)
  }
}

export function useRemovalLocators() {
  useSyncExternalStore(subscribe, () => window.location.search)
  return readRemovalLocators()
}

// Paired, repeated parameters preserve every Product's non-secret recovery locator,
// including across reload when session storage is unavailable. No command is replayed.
export function readRemovalLocators(): RemovalLocator[] {
  const byProduct = new Map<string, RemovalLocator>()
  for (const locator of [...outstandingRemovalLocators(), ...readUrlRemovalLocators()]) {
    if (operationPattern.test(locator.operationId) && canonicalizeGuid(locator.productId) === locator.productId) {
      byProduct.set(locator.productId, locator)
    }
  }
  return [...byProduct.values()]
}

function readUrlRemovalLocators(): RemovalLocator[] {
  const params = new URLSearchParams(window.location.search)
  const operations = params.getAll('productRemoval')
  const products = params.getAll('removedProduct')
  if (operations.length !== products.length) return []
  const locators = new Map<string, RemovalLocator>()
  operations.forEach((value, index) => {
    const operationId = canonicalizeGuid(value)
    const productId = canonicalizeGuid(products[index])
    if (operationId && operationPattern.test(operationId) && productId) {
      locators.set(productId, { operationId, productId })
    }
  })
  return [...locators.values()]
}

export function readRemovalLocator(productId?: string): RemovalLocator | null {
  const locators = readRemovalLocators()
  return (productId ? locators.find(locator => locator.productId === productId) : locators[locators.length - 1]) ?? null
}

function writeLocators(locators: RemovalLocator[]) {
  const url = new URL(window.location.href)
  url.searchParams.delete('productRemoval')
  url.searchParams.delete('removedProduct')
  for (const locator of locators) {
    url.searchParams.append('productRemoval', locator.operationId)
    url.searchParams.append('removedProduct', locator.productId)
  }
  window.history.replaceState(window.history.state, '', url)
  window.dispatchEvent(new Event(event))
}

export function writeRemovalLocator(operationId: string, productId: string) {
  if (!operationPattern.test(operationId) || canonicalizeGuid(productId) !== productId) return
  writeLocators([...readRemovalLocators().filter(locator => locator.productId !== productId), { operationId, productId }])
}

export function clearRemovalLocator(operationId: string) {
  writeLocators(readRemovalLocators().filter(locator => locator.operationId !== operationId))
}

export function removalOperationFromStatusUrl(clientId: string, statusUrl: unknown): string | null {
  const prefix = `/api/backoffice/clients/${clientId}/product-removals/`
  if (typeof statusUrl !== 'string' || !statusUrl.startsWith(prefix)) return null
  const operationId = statusUrl.slice(prefix.length)
  return operationPattern.test(operationId) ? operationId : null
}
