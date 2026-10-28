import { describe, expect, it } from 'vitest'
import vectors from './navigation/reference-cases.json'
import origin from './v1/fixtures/valid/origin-full.json'
import type { ProductContentV1 } from '../../types/content'
import { publicationReferences, resolvePublicationHref } from './publicationReferences'
import { validateProductContent } from './validator'

describe('separate publication references', () => {
  for (const vector of vectors.cases) {
    it(`${vector.id} ${JSON.stringify(vector.href)}`, () => {
      const content = structuredClone(origin) as unknown as ProductContentV1
      content.slug = vector.slug
      content.hero.cta.href = '/independent'
      content.hero.secondaryCta!.href = '/independent'
      content.footer = [{ heading: 'Fixture', links: [{ name: 'Fixture', href: vector.href }] }]

      for (const [target, presence] of Object.entries(vector.presence)) {
        const section = target === 'faq' ? 'questions' : target

        if (presence === 'absent') {
          Reflect.deleteProperty(content, section)
        } else if (presence === 'empty' && section === 'features') {
          content.features!.items.splice(0)
        } else if (presence === 'empty' && section === 'questions') {
          content.questions!.items.splice(0)
        }
      }

      expect(resolvePublicationHref(content, vector.href)).toBe(vector.landing)
      const issues = publicationReferences(content)
      expect(issues.map(issue => [issue.path, issue.code])).toEqual(vector.code === 'missing_section_target' ? [[vector.path, vector.code]] : [])
    })
  }

  it('retained missing targets remain structurally readable and safe drafts remain valid', () => {
    const content = structuredClone(origin)
    content.hero.cta.href = '#missing'
    expect(validateProductContent(content, 'publish').valid).toBe(true)
    expect(validateProductContent(content, 'draft').valid).toBe(true)
    expect(publicationReferences(content as unknown as ProductContentV1)[0].path).toBe('/hero/cta/href')
  })
})
