import { parse, isLosslessNumber } from 'lossless-json'
import { apiClient } from './apiClient'
import { canonicalizeGuid } from '../lib/guid'
export interface PlatformClient {
  id: string; name: string; status: number; clientClassification: 'customer' | 'soveris_internal'; classificationRevision: string; createdAt: string
}
export function parsePlatformClient(text: string, target: string): PlatformClient {
  const value = parse(text) as Record<string, unknown> | null
  const fields = ['id','name','status','clientClassification','classificationRevision','createdAt']
  const revision=value && isLosslessNumber(value.classificationRevision) ? value.classificationRevision.toString() : ''
  const status=value && isLosslessNumber(value.status) ? Number(value.status.toString()) : NaN
  if (!value || Array.isArray(value) || Object.keys(value).length!==fields.length || !fields.every(k=>k in value) ||
      value.id!==target || canonicalizeGuid(value.id)!==target || typeof value.name!=='string' || !value.name.trim() || value.name.length>500 ||
      !Number.isInteger(status) || status<0 || status>32767 || !['customer','soveris_internal'].includes(value.clientClassification as string) ||
      !/^(0|[1-9]\d{0,18})$/.test(revision) || BigInt(revision)>9223372036854775807n ||
      typeof value.createdAt!=='string' || !/^\d{4}-\d{2}-\d{2}T/.test(value.createdAt) || !Number.isFinite(Date.parse(value.createdAt)))
    throw new Error('Client metadata unavailable')
  return {...value, status, classificationRevision:revision} as PlatformClient
}
export async function readPlatformClient(target: string, signal: AbortSignal) {
  if (!target || target==='00000000-0000-0000-0000-000000000000' || canonicalizeGuid(target)!==target) throw new Error('Invalid Client context')
  const response=await apiClient.get<string>(`/clients/${target}`, {signal, responseType:'text', transformResponse:[v=>v], retryOnUnauthorized:false})
  return parsePlatformClient(response.data,target)
}
