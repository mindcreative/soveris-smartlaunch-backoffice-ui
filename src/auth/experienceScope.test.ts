import { QueryClient } from '@tanstack/react-query'
import { expect,it,vi } from 'vitest'
import { bindExperienceScope } from './experienceScope'
import { privateExperienceKey } from './experienceKey'
import { currentAuthorityEpoch, privateObjectUrl } from './authorityEpoch'
import { registerReportScope } from '../queries/billingReportKeys'
import { registerAnomalyScope } from '../queries/billingAnomalyKeys'
import { localSubscriptionAttemptScope, localSubscriptionAttemptScopeIsCurrent, retainLocalSubscriptionAttempt, retainedLocalSubscriptionAttempt } from '../queries/localSubscriptionAttemptScope'
it('retires reports anomalies blobs and optimistic state before cancellation yields on a target change',()=>{
  const queries=new QueryClient(),report=vi.fn(),anomaly=vi.fn()
  const cleanupReport=registerReportScope('A','credit',report)
  const cleanupAnomaly=registerAnomalyScope('A',anomaly)
  const create=vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:owned'),revoke=vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{})
  privateObjectUrl(new Blob(['private']))
  queries.setQueryData(['backoffice','private','platform','A'],{privateValue:'retired'})
  queries.setQueryData(['backoffice','submissions'],{privateValue:'workspace'})
  const epoch=currentAuthorityEpoch(),before=privateExperienceKey()
  bindExperienceScope('platform:B:actor:session:revision',queries)
  expect(currentAuthorityEpoch()).toBe(epoch+1)
  expect(privateExperienceKey()).not.toEqual(before)
  expect(report).toHaveBeenCalledOnce();expect(anomaly).toHaveBeenCalledOnce();expect(revoke).toHaveBeenCalledWith('blob:owned')
  expect(queries.getQueryCache().getAll()).toHaveLength(0)
  bindExperienceScope('platform:B:actor:session:revision',queries)
  expect(currentAuthorityEpoch()).toBe(epoch+1)
  cleanupReport();cleanupAnomaly();create.mockRestore();revoke.mockRestore()
})
it('retires retained subscription commands before a target or authority revision can replay them',()=>{
  const queries=new QueryClient()
  const first=localSubscriptionAttemptScope('client-A')
  retainLocalSubscriptionAttempt(first,{body:'exact-bytes',operationId:'019d0e15-c3f0-7a55-8bc2-9cf0a1b2c3d4'})
  bindExperienceScope('platform:client-B:actor:session:revision',queries)
  expect(retainedLocalSubscriptionAttempt(first)).toBeUndefined()
  const second=localSubscriptionAttemptScope('client-B')
  retainLocalSubscriptionAttempt(second,{body:'new-exact-bytes',operationId:'019d0e15-c3f0-7a55-8bc2-9cf0a1b2c3d5'})
  window.dispatchEvent(new Event('auth:refreshed'))
  expect(retainedLocalSubscriptionAttempt(second)).toBeUndefined()
  expect(localSubscriptionAttemptScopeIsCurrent(second,'client-B')).toBe(false)
})
