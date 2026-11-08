import type { SupportGrantScope, SupportProductLabel } from './models'

const identifiers = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])/gi
export function supportText(value: string | null | undefined, unavailable = 'Label unavailable'): string {
  return value?.trim() ? value.replace(identifiers, '[Identifier hidden]') : unavailable
}
export function productLabel(product: SupportProductLabel): string {
  return supportText(product.name) + ' · ' + supportText(product.slug)
}
export function requestLabel(grant: SupportGrantScope): string {
  return supportText(grant.supportCaseReference) + ' · ' + supportText(grant.targetClientName)
    + ' · ' + new Date(grant.createdAt).toLocaleString()
}

export function readableLabelKey(value: string): string {
  return supportText(value).normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase()
}

export function operatorLabel(grant: SupportGrantScope, context: readonly SupportGrantScope[]): string {
  const operators = [...new Set([...context, grant].filter(item => readableLabelKey(item.operatorName) === readableLabelKey(grant.operatorName)).map(item => item.operatorId))]
  return supportText(grant.operatorName) + (operators.length > 1 ? ' · operator ' + (operators.indexOf(grant.operatorId) + 1) : '')
}

export function supportReadLabel(operation: string): string {
  return operation === 'product.identity.read' ? 'Product identity' : 'Draft content'
}
