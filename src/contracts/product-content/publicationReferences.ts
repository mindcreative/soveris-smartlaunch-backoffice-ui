import type { ProductContentV1, ProductContentValidationIssue } from '../../types/content'
import { safeLink } from './validator'
import { FEATURES_COMPATIBILITY_TARGET, PRODUCT_SECTION_TARGETS } from './navigation/constants'

export function publicationTargets(content: ProductContentV1): string[] {
  return PRODUCT_SECTION_TARGETS.filter(target => {
    switch (target) {
      case 'hero':
        return Boolean(content.hero)
      case 'features':
        return Array.isArray(content.features?.items) && content.features.items.length > 0
      case 'faq':
        return Array.isArray(content.questions?.items) && content.questions.items.length > 0
      case 'form':
        return Boolean(content.form)
    }
  })
}

function localTarget(href: string, slug: string): string | null {
  const fragmentIndex = href.indexOf('#')

  if (fragmentIndex < 0) {
    return null
  }

  const path = href.slice(0, fragmentIndex)

  if (path !== '' && path !== '/' && path !== `/${slug}`) {
    return null
  }

  const fragment = href.slice(fragmentIndex + 1)

  return fragment === FEATURES_COMPATIBILITY_TARGET ? 'features' : fragment
}

export function resolvePublicationHref(content: ProductContentV1, href: string): string | null {
  if (!safeLink(href)) {
    return null
  }

  const target = localTarget(href, content.slug)

  if (target === null) {
    return href
  }

  return publicationTargets(content).includes(target) ? `#${target}` : null
}

// This separate advice never changes the established structural reader profiles.
export function publicationReferences(content: ProductContentV1): ProductContentValidationIssue[] {
  const targets = publicationTargets(content)
  const links: Array<[string, string | undefined]> = [
    ['/hero/cta/href', content.hero?.cta?.href],
    ['/hero/secondaryCta/href', content.hero?.secondaryCta?.href],
  ]
  const errors: ProductContentValidationIssue[] = []
  content.footer?.forEach((group, groupIndex) => group.links.forEach((link, linkIndex) => {
    links.push([`/footer/${groupIndex}/links/${linkIndex}/href`, link.href])
  }))

  for (const [path, href] of links) {
    // Syntax/schema blocking belongs to the existing validator and field errors.
    if (href === undefined || !safeLink(href)) {
      continue
    }

    const target = localTarget(href, content.slug)

    if (target !== null && !targets.includes(target)) {
      errors.push({ path, keyword: 'reference', code: 'missing_section_target',
        message: `The local target #${target} does not render. Add its section or edit/remove this link before publishing. Available targets: ${targets.map(value => `#${value}`).join(', ') || 'none'}.` })
    }
  }

  return errors
}
