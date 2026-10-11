import type { ProductContentV1 } from '../../types/content'
import type { ProductImageRole } from '../../types/productImages'
import type { CompletedGeneratedProductImage } from '../../types/generatedProductImages'
import { cloneProductContent } from './productEditorModel'

export interface GeneratedImageTarget { pointer: string; role: ProductImageRole; snapshot: string }
export interface VerifiedGeneratedImageSelection {
  actorId: string; clientId: string; productId: string; draftRevision: number; target: GeneratedImageTarget
  receipt: CompletedGeneratedProductImage; alt: string
}
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, ordered(child)]))
  return value
}
export function semanticProductEqual(left: unknown, right: unknown): boolean { return JSON.stringify(ordered(left)) === JSON.stringify(ordered(right)) }
export function captureGeneratedImageTarget(content: ProductContentV1, pointer: string): GeneratedImageTarget | null {
  if (pointer === '/hero/backgroundImage') return { pointer, role: 'hero', snapshot: JSON.stringify(ordered(content.hero.backgroundImage)) }
  const match = /^\/features\/items\/(\d+)\/image$/.exec(pointer)
  if (!match || !content.features?.items[Number(match[1])]) return null
  // Capture the feature list as well as the position so reorders/replacements
  // cannot quietly redirect a selected result into another destination.
  return { pointer, role: 'feature', snapshot: JSON.stringify(ordered(content.features.items)) }
}
export function sameImageTarget(content: ProductContentV1, target: GeneratedImageTarget): boolean {
  const current = captureGeneratedImageTarget(content, target.pointer)
  return current !== null && current.role === target.role && current.snapshot === target.snapshot
}
export function mergeGeneratedImage(content: ProductContentV1, target: GeneratedImageTarget, src: string, alt: string): ProductContentV1 {
  if (!sameImageTarget(content, target) || !alt.trim() || [...alt].length > 120 || !src.startsWith('/assets/product-images/'))
    throw new Error('The image destination or alternative text needs review.')
  const merged = cloneProductContent(content)
  if (target.role === 'hero') merged.hero.backgroundImage = { src, alt }
  else {
    const index = Number(/^\/features\/items\/(\d+)\/image$/.exec(target.pointer)![1])
    merged.features!.items[index]!.image = { src, alt }
  }
  return merged
}
