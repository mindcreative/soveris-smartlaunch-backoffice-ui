import type { AiGenerationTarget, AiJobStatusDto } from '../../types/aiContent'
import type { ProductContentV1 } from '../../types/content'
import { cloneProductContent } from './productEditorModel'

export interface AiApplyTarget {
  pointer: string
  label: string
}

export interface VerifiedAiApplySelection {
  actorId: string
  clientId: string
  productId: string
  target: AiGenerationTarget
  targetPointer: string
  targetLabel: string
  targetValue: string
  draftRevision: number
  jobId: string
  resultId: string
  variationIndex: number
  variation: string
  job: AiJobStatusDto
}

export interface AiApplyOutcome {
  kind: 'saved' | 'review' | 'permission_lost'
}

const simpleTargets: Partial<Record<AiGenerationTarget, AiApplyTarget>> = {
  headline: { pointer: '/hero/title', label: 'Hero title' },
  description: { pointer: '/hero/subtitle', label: 'Hero subtitle' },
  rewrite: { pointer: '/hero/subtitle', label: 'Hero subtitle' },
  cta: { pointer: '/hero/cta/label', label: 'Primary call-to-action label' },
  meta_title: { pointer: '/seo/metaTitle', label: 'SEO meta title' },
  meta_description: { pointer: '/seo/metaDescription', label: 'SEO meta description' },
}

export function aiApplyTargets(content: ProductContentV1, target: AiGenerationTarget): AiApplyTarget[] {
  const simple = simpleTargets[target]
  if (simple) return [simple]
  if (target === 'hero') return [
    { pointer: '/hero/title', label: 'Hero title' },
    { pointer: '/hero/subtitle', label: 'Hero subtitle' },
    { pointer: '/hero/cta/label', label: 'Primary call-to-action label' },
  ]
  if (target === 'features' && content.features) return [
    { pointer: '/features/heading', label: 'Features heading' },
    { pointer: '/features/description', label: 'Features description' },
    ...content.features.items.flatMap((_, index) => [
      { pointer: `/features/items/${index}/title`, label: `Feature ${index + 1} title` },
      { pointer: `/features/items/${index}/description`, label: `Feature ${index + 1} description` },
    ]),
  ]
  if (target === 'faq' && content.questions) return [
    { pointer: '/questions/heading', label: 'Questions heading' },
    { pointer: '/questions/description', label: 'Questions description' },
    ...content.questions.items.flatMap((_, index) => [
      { pointer: `/questions/items/${index}/question`, label: `Question ${index + 1} question` },
      { pointer: `/questions/items/${index}/answer`, label: `Question ${index + 1} answer` },
    ]),
  ]
  return []
}

export function readAiScalar(content: ProductContentV1, pointer: string): string | null {
  if (pointer === '/hero/title') return content.hero.title
  if (pointer === '/hero/subtitle') return content.hero.subtitle
  if (pointer === '/hero/cta/label') return content.hero.cta.label
  if (pointer === '/seo/metaTitle') return content.seo?.metaTitle ?? ''
  if (pointer === '/seo/metaDescription') return content.seo?.metaDescription ?? ''
  let match = /^\/features\/items\/(\d+)\/(title|description)$/.exec(pointer)
  if (match) return content.features?.items[Number(match[1])]?.[match[2] as 'title' | 'description'] ?? null
  if (pointer === '/features/heading') return content.features?.heading ?? null
  if (pointer === '/features/description') return content.features?.description ?? ''
  match = /^\/questions\/items\/(\d+)\/(question|answer)$/.exec(pointer)
  if (match) return content.questions?.items[Number(match[1])]?.[match[2] as 'question' | 'answer'] ?? null
  if (pointer === '/questions/heading') return content.questions?.heading ?? null
  if (pointer === '/questions/description') return content.questions?.description ?? ''
  return null
}

export function mergeAiVariation(content: ProductContentV1, pointer: string, variation: string): ProductContentV1 {
  if (typeof variation !== 'string' || !variation.trim()) throw new Error('The selected variation is not durable nonblank text.')
  if (readAiScalar(content, pointer) === null) throw new Error('The destination is not an eligible scalar field.')
  const merged = cloneProductContent(content)
  if (pointer === '/hero/title') merged.hero.title = variation
  else if (pointer === '/hero/subtitle') merged.hero.subtitle = variation
  else if (pointer === '/hero/cta/label') merged.hero.cta.label = variation
  else if (pointer === '/seo/metaTitle') merged.seo = { ...merged.seo, metaTitle: variation }
  else if (pointer === '/seo/metaDescription') merged.seo = { ...merged.seo, metaDescription: variation }
  else if (pointer === '/features/heading') merged.features!.heading = variation
  else if (pointer === '/features/description') merged.features!.description = variation
  else if (pointer === '/questions/heading') merged.questions!.heading = variation
  else if (pointer === '/questions/description') merged.questions!.description = variation
  else {
    let match = /^\/features\/items\/(\d+)\/(title|description)$/.exec(pointer)
    if (match) merged.features!.items[Number(match[1])]![match[2] as 'title' | 'description'] = variation
    else {
      match = /^\/questions\/items\/(\d+)\/(question|answer)$/.exec(pointer)
      if (!match) throw new Error('The destination is not an eligible scalar field.')
      merged.questions!.items[Number(match[1])]![match[2] as 'question' | 'answer'] = variation
    }
  }
  return merged
}
