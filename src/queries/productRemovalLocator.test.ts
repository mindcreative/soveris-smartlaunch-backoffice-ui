import { beforeEach, expect, it } from 'vitest'
import { client, product, operation } from '../test/fixtures/productRemoval'
import { clearRemovalLocator, readRemovalLocator, readRemovalLocators, writeRemovalLocator } from './productRemovalLocator'

const otherProduct = '01990000-0000-7000-8000-000000000077'
const otherOperation = '01990000-0000-7000-8000-000000000088'
beforeEach(() => window.history.replaceState({ navigation: 'preserved' }, '', '/products?filter=archived'))

it('preserves each Product locator and unrelated navigation state through updates and removal', () => {
  writeRemovalLocator(operation, product)
  writeRemovalLocator(otherOperation, otherProduct)
  expect(readRemovalLocators()).toEqual([
    { operationId: operation, productId: product },
    { operationId: otherOperation, productId: otherProduct },
  ])
  expect(readRemovalLocator(product)?.operationId).toBe(operation)
  clearRemovalLocator(otherOperation)
  expect(readRemovalLocators()).toEqual([{ operationId: operation, productId: product }])
  expect(new URLSearchParams(window.location.search).get('filter')).toBe('archived')
  expect(window.history.state).toEqual({ navigation: 'preserved' })
})

it('updates the canonical operation for one Product without losing another outstanding request', () => {
  writeRemovalLocator(operation, product)
  writeRemovalLocator(otherOperation, otherProduct)
  const canonicalOperation = '01990000-0000-7000-8000-000000000066'
  writeRemovalLocator(canonicalOperation, product)
  expect(readRemovalLocator(product)?.operationId).toBe(canonicalOperation)
  expect(readRemovalLocator(otherProduct)?.operationId).toBe(otherOperation)
  expect(readRemovalLocators()).toHaveLength(2)
})

it.each([
  `productRemoval=${operation}&removedProduct=${product}&productRemoval=${otherOperation}`,
  `productRemoval=invalid&removedProduct=${product}`,
  `productRemoval=${operation.replace('-7000-', '-4000-')}&removedProduct=${product}`,
  `productRemoval=${operation}&removedProduct=invalid`,
])('rejects malformed or unpaired locators: %s', query => {
  window.history.replaceState({}, '', `/products?${query}`)
  expect(readRemovalLocators()).toEqual([])
})

it('stores no Client authority, command fingerprint or private Product content in URL locators', () => {
  writeRemovalLocator(operation, product)
  expect(window.location.search).not.toContain(client)
  expect([...new URLSearchParams(window.location.search).keys()]).toEqual(['filter', 'productRemoval', 'removedProduct'])
})
