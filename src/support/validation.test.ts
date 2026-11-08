import { expect, it } from 'vitest'
import { buildSupportRequest } from './validation'
import { SUPPORT } from './constants'

const target = '0149620b-af5c-47c9-8290-95edde45ef8f'
const product = '019d0e15-c3f0-7a55-8bc2-9cf0a1b2c3d5'
it('builds one finite canonical request without actor, proof or emergency selectors', () => {
  const input = buildSupportRequest(target.toUpperCase(), product.toUpperCase(), [SUPPORT.identityRead, SUPPORT.draftRead], '60', '  ' + '😀'.repeat(500) + '  ', 'case:123')
  expect(input.targetClientId).toBe(target)
  expect(input.productIds).toEqual([product])
  expect(input.operations).toEqual([SUPPORT.draftRead, SUPPORT.identityRead])
  expect(Array.from(input.reason)).toHaveLength(500)
  expect(input.operationId[14]).toBe('7')
  expect(Object.keys(input).sort()).toEqual(['durationMinutes', 'operationId', 'operations', 'productIds', 'reason', 'supportCaseReference', 'targetClientId'])
})
it.each([
  ['duplicate', product + ',' + product], ['empty', ''], ['over-limit', Array.from({ length: 21 }, (_, index) => product.slice(0, -2) + index.toString(16).padStart(2, '0')).join(',')],
])('rejects %s product selection before network effects', (_, products) => {
  expect(() => buildSupportRequest(target, products, [SUPPORT.draftRead], '60', 'Reason', 'case:123')).toThrow()
})
it.each(['0', '61', '1.5', 'NaN'])('rejects noncontract duration %s', minutes => {
  expect(() => buildSupportRequest(target, product, [SUPPORT.draftRead], minutes, 'Reason', 'case:123')).toThrow()
})
it.each(['😀'.repeat(501), 'a\u0000b', 'a\nother', '\uD800'])('rejects invalid reason scalar/control input %#', reason => {
  expect(() => buildSupportRequest(target, product, [SUPPORT.draftRead], '60', reason, 'case:123')).toThrow()
})
