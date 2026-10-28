import type { ProductContentV1, ProductContentValidationIssue } from '../../types/content'
import { resolvePublicationHref } from '../../contracts/product-content/publicationReferences'

export function footerNavigationAdvice(content: ProductContentV1): ProductContentValidationIssue[] {
  const advice: ProductContentValidationIssue[] = []
  const occurrences = new Map<string, string>()
  const names = new Map<string, Array<{ href: string; path: string }>>()
  const primaryHref = resolvePublicationHref(content, content.hero.cta.href)

  content.footer?.forEach((group, groupIndex) => group.links.forEach((link, linkIndex) => {
    const path = `/footer/${groupIndex}/links/${linkIndex}/href`
    const name = link.name.trim()
    const href = resolvePublicationHref(content, link.href)

    if (!name || href === null) {
      return
    }

    const identity = JSON.stringify([name, href])
    const firstPath = occurrences.get(identity)

    if (firstPath) {
      advice.push({ path, code: 'duplicate_footer_link', keyword: 'advice',
        message: `Exact duplicate at ${path} and ${firstPath}. Only the first visible occurrence at ${firstPath} renders. Edit or remove a link explicitly; saved content is preserved.` })
    } else {
      occurrences.set(identity, path)
    }

    const previous = names.get(name) ?? []
    const different = previous.find(candidate => candidate.href !== href)

    if (different) {
      advice.push({ path, code: 'ambiguous_footer_name', keyword: 'advice',
        message: `The same name has different destinations at ${different.path} and ${path}. Both links remain. Edit the names or remove a link if unintended.` })
    }

    previous.push({ href, path })
    names.set(name, previous)

    if (primaryHref !== null && href === primaryHref && name !== content.hero.cta.label.trim()) {
      advice.push({ path, code: 'footer_primary_name_differs', keyword: 'advice',
        message: 'This destination matches the primary CTA but its name differs. Keep it as a distinct link, or choose Use primary CTA to copy the current label and URL. Later Hero changes do not update this link.' })
    }
  }))

  return advice
}
