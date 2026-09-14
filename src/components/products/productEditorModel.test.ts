import { describe, expect, it } from 'vitest'
import origin from '../../contracts/product-content/v1/fixtures/valid/origin-full.json'
import type { Product, ProductContentEnvelope, ProductContentV1 } from '../../types/content'
import {
  createBlankProductContent,
  pointerToFieldId,
  selectEditorContent,
} from './productEditorModel'

const product: Product = {
  id: 'product-id', clientId: 'client-id', name: 'Authoritative name', slug: 'authoritative-slug',
  status: 'active', publicationStatus: 'draft', revision: 1,
  contentSchemaVersion: null, contentRevision: 1, draftSchemaVersion: null,
  draftRevision: 0, completeness: { isComplete: false, missingRequirements: ['form'] },
  canonicalUrl: null, createdAt: '2026-09-12T00:00:00Z', updatedAt: '2026-09-12T00:00:00Z',
}

describe('product editor model', () => {
  it('selects retained draft before live and returns a lossless private clone', () => {
    const full = origin as unknown as ProductContentV1
    const live = { ...full, hero: { ...full.hero, title: 'Live title' } }
    const draft = { ...full, hero: { ...full.hero, title: 'Draft title' } }
    const envelope: ProductContentEnvelope = {
      productId: product.id, schemaVersion: 1, revision: 4, content: live,
      draft: { schemaVersion: 1, revision: 7, content: draft },
    }
    const selected = selectEditorContent(product, envelope)
    expect(selected).toEqual(draft)
    expect(selected).not.toBe(draft)
    expect(selected.footer).toEqual(full.footer)
    expect(selected.form?.schema.properties).toEqual(full.form?.schema.properties)
  })

  it('uses live when no draft and otherwise creates only required blank structure', () => {
    const full = origin as unknown as ProductContentV1
    expect(selectEditorContent(product, {
      productId: product.id, schemaVersion: 1, revision: 2, content: full,
    })).toEqual(full)

    const blank = createBlankProductContent(product)
    expect(blank).toEqual({
      slug: product.slug,
      name: product.name,
      hero: {
        title: '', subtitle: '', cta: { label: '', href: '' },
        backgroundImage: { src: '', alt: '' },
      },
    })
    expect(blank).not.toHaveProperty('features')
    expect(blank).not.toHaveProperty('form')
    expect(blank).not.toHaveProperty('footer')
    expect(blank).not.toHaveProperty('seo')
  })

  it('maps JSON Pointers with escaped dynamic names to stable field IDs', () => {
    expect(pointerToFieldId('/form/schema/properties/contact~1email/title')).toBe(
      'product-field-%2Fform%2Fschema%2Fproperties%2Fcontact~1email%2Ftitle',
    )
  })
})
