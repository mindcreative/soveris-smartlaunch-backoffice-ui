import { describe, expect, it } from 'vitest'
import { parseRemovalPreview, parseRemovalReceipt } from './productRemovalContracts'
import { client,product,dependencies,preview } from '../test/fixtures/productRemoval'
describe('product removal wire contract',()=>{
 it('accepts complete scoped preview and preserves int64 revision',()=>{
  expect(parseRemovalPreview(JSON.stringify(preview).replace('"revision":1','"revision":9223372036854775807'),client,product).revision).toBe('9223372036854775807')
 })
 it('denies partial, foreign, unknown policy, duplicate fields and false eligibility',()=>{
  for(const value of [{...preview,policyVersion:'unknown'},{...preview,clientId:product},{...preview,dependencies:{}},{...preview,extra:true},{...preview,dependencies:{...dependencies,submissions:1}}])
   expect(()=>parseRemovalPreview(JSON.stringify(value),client,product)).toThrow()
  expect(()=>parseRemovalPreview(JSON.stringify(preview).replace('"revision":1','"revision":1,"revision":2'),client,product)).toThrow()
 })
 it('does not turn a Product 404 or incomplete receipt into successful removal',()=>{
  expect(()=>parseRemovalReceipt('{"status":404}',client)).toThrow()
  expect(()=>parseRemovalReceipt('{"outcome":"removed"}',client)).toThrow()
 })
})
