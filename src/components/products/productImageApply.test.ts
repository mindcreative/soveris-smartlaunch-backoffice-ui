import { describe, expect, it } from 'vitest'
import { captureGeneratedImageTarget, mergeGeneratedImage, sameImageTarget } from './productImageApply'
import type { ProductContentV1 } from '../../types/content'

const content: ProductContentV1 = { name: 'Product', slug: 'product', hero: { title: 'Title', subtitle: 'Subtitle',
  cta: { label: 'Join', href: '/join' }, backgroundImage: { src: '/old.webp', alt: 'Old image' } },
  features: { heading: 'Features', items: [{ title: 'First', description: 'First description' }, { title: 'Second', description: 'Second description' }] },
  seo: { metaTitle: 'Keep SEO' }, footer: [{ heading: 'Keep footer', links: [{ name: 'Terms', href: '/terms' }] }] }
describe('generated image canonical merge', () => {
  it('replaces only chosen src/alt and preserves every unrelated value and omission', () => {
    const target = captureGeneratedImageTarget(content, '/features/items/0/image')!
    const merged = mergeGeneratedImage(content, target, '/assets/product-images/image.webp', 'User-owned alt')
    expect(merged.features!.items[0]!.image).toEqual({ src: '/assets/product-images/image.webp', alt: 'User-owned alt' })
    expect(merged.hero).toEqual(content.hero); expect(merged.footer).toEqual(content.footer); expect(merged.seo).toEqual(content.seo)
    expect(content.features!.items[0]!.image).toBeUndefined(); expect(merged.features!.items[1]!.image).toBeUndefined()
  })
  it('rejects reorder, removed feature, changed image and blank/oversized alt', () => {
    const target = captureGeneratedImageTarget(content, '/features/items/0/image')!
    const changed = structuredClone(content); changed.features!.items.reverse()
    expect(sameImageTarget(changed, target)).toBe(false)
    expect(() => mergeGeneratedImage(changed, target, '/new.webp', 'Alt')).toThrow()
    expect(() => mergeGeneratedImage(content, target, '/new.webp', ' ')).toThrow()
    expect(() => mergeGeneratedImage(content, target, '/new.webp', 'x'.repeat(121))).toThrow()
  })
})
