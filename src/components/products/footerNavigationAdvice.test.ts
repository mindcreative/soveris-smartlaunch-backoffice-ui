import { expect, it } from 'vitest'
import origin from '../../contracts/product-content/v1/fixtures/valid/origin-full.json'
import type { ProductContentV1 } from '../../types/content'
import { footerNavigationAdvice } from './footerNavigationAdvice'
import { copyPrimaryCta } from './productEditorModel'

it('explains resolved duplicates and distinct destinations with exact paths without changing the document', () => {
  const content = structuredClone(origin) as unknown as ProductContentV1
  content.hero.cta = { label: 'Go', href: '#form' }
  content.footer = [
    { heading: 'One', links: [{ name: 'Read', href: '#principles' }, { name: 'Distinct', href: '#form' }] },
    { heading: 'Two', links: [{ name: ' Read ', href: '/origin#features' }, { name: 'Read', href: '/other' }] },
  ]
  const before = structuredClone(content)
  const advice = footerNavigationAdvice(content)
  expect(advice.map(issue => issue.code)).toEqual(['footer_primary_name_differs', 'duplicate_footer_link', 'ambiguous_footer_name'])
  expect(advice[1].message).toContain('/footer/0/links/0/href')
  expect(advice[1].message).toContain('/footer/1/links/0/href')
  expect(advice[2].message).toContain('Both links remain')
  expect(content).toEqual(before)
  const copied = copyPrimaryCta(content, 0, 1)
  expect(copied.footer![0].links[1]).toEqual({ name: 'Go', href: '#form' })
  expect(copied.footer![1]).toEqual(content.footer![1])
  expect(copyPrimaryCta(content, 9, 9)).toEqual(content)
})
