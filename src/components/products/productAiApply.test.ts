import { describe, expect, it } from 'vitest'
import originFixture from '../../contracts/product-content/v1/fixtures/valid/origin-full.json'
import minimalFixture from '../../contracts/product-content/v1/fixtures/valid/minimal-draft-no-optionals.json'
import type { ProductContentV1 } from '../../types/content'
import { aiApplyTargets, mergeAiVariation, readAiScalar } from './productAiApply'

const origin = originFixture as unknown as ProductContentV1
const minimal = minimalFixture as unknown as ProductContentV1

describe('generated-content scalar application', () => {
  it('offers only explicit editable scalar destinations for structured sections', () => {
    expect(aiApplyTargets(origin, 'hero').map((item) => item.pointer)).toEqual([
      '/hero/title', '/hero/subtitle', '/hero/cta/label',
    ])
    expect(aiApplyTargets(origin, 'features').map((item) => item.pointer)).toEqual([
      '/features/heading', '/features/description',
      '/features/items/0/title', '/features/items/0/description',
      '/features/items/1/title', '/features/items/1/description',
      '/features/items/2/title', '/features/items/2/description',
    ])
    expect(aiApplyTargets(origin, 'faq')).toContainEqual({
      pointer: '/questions/items/0/answer', label: 'Question 1 answer',
    })
    expect(aiApplyTargets(origin, 'image_prompt')).toEqual([])
  })

  it('clones the whole draft and changes exactly one selected scalar', () => {
    const merged = mergeAiVariation(origin, '/features/items/1/description', 'New durable prose')
    expect(merged).not.toBe(origin)
    expect(merged.features?.items[1]?.description).toBe('New durable prose')
    expect(origin.features?.items[1]?.description).toBe('Intelligence that never needs the internet')
    const expected = structuredClone(origin)
    expected.features!.items[1]!.description = 'New durable prose'
    expect(merged).toEqual(expected)
  })

  it('creates only the minimal optional SEO object when the selected SEO field is absent', () => {
    const merged = mergeAiVariation(minimal, '/seo/metaTitle', 'Durable SEO title')
    expect(merged.seo).toEqual({ metaTitle: 'Durable SEO title' })
    expect(readAiScalar(merged, '/seo/metaTitle')).toBe('Durable SEO title')
  })

  it.each([
    '/hero', '/features', '/questions/items/0', '/hero/backgroundImage/alt',
    '/hero/cta/href', '/footer/0/heading', '/form/fields/0/label', '/seo',
  ])('rejects an ambiguous, asset, URL, form, footer or object target: %s', (pointer) => {
    expect(() => mergeAiVariation(origin, pointer, 'Provider prose')).toThrow(/eligible scalar/i)
  })
})
