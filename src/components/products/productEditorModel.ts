import type {
  Product,
  ProductContentEnvelope,
  ProductContentValidationIssue,
  ProductContentV1,
} from '../../types/content'
import type { ContractIssue } from '../../contracts/product-content/validator'

export function cloneProductContent(content: ProductContentV1): ProductContentV1 {
  return structuredClone(content)
}

export function createBlankProductContent(product: Pick<Product, 'name' | 'slug'>): ProductContentV1 {
  return {
    slug: product.slug,
    name: product.name,
    hero: {
      title: '',
      subtitle: '',
      cta: { label: '', href: '' },
      backgroundImage: { src: '', alt: '' },
    },
  }
}

function hasCanonicalContent(value: ProductContentEnvelope['content']): value is ProductContentV1 {
  return typeof value === 'object' && value !== null && 'hero' in value && 'name' in value && 'slug' in value
}

export function selectEditorContent(product: Product, envelope: ProductContentEnvelope): ProductContentV1 {
  if (envelope.draft) return cloneProductContent(envelope.draft.content)
  if (envelope.schemaVersion !== null && hasCanonicalContent(envelope.content)) {
    return cloneProductContent(envelope.content)
  }
  return createBlankProductContent(product)
}

export function pointerToFieldId(pointer: string): string {
  return `product-field-${encodeURIComponent(pointer)}`
}

export function issueMessage(issue: Pick<ProductContentValidationIssue, 'code' | 'message'> | ContractIssue): string {
  if ('message' in issue && issue.message) return issue.message
  const messages: Record<string, string> = {
    schema_required: 'Complete this required field.',
    schema_minLength: 'Enter a value; this field cannot be blank.',
    schema_maxLength: 'Shorten this value to the allowed length.',
    schema_minItems: 'Add at least one item.',
    schema_maxItems: 'Remove items above the allowed limit.',
    schema_pattern: 'Use the required format.',
    schema_format: 'Use a valid value for this field.',
    schema_type: 'Use the required value type.',
    schema_const: 'Choose a supported value.',
    schema_oneOf: 'Choose one supported field profile.',
    unsafe_url: 'Use a root-relative path, fragment, or secure HTTPS URL.',
    unsafe_image_url: 'Use a root-relative image path.',
    publication_email_field_missing: 'Add one Email field before publishing.',
    publication_email_field_multiple: 'Keep exactly one Email field before publishing.',
    publication_email_field_optional: 'Mark the Email field as required before publishing.',
    duplicate_field_order: 'Give each form field a unique order.',
    invalid_field_bounds: 'Correct the minimum and maximum limits.',
    invalid_enum_labels: 'Provide one label for every option.',
    invalid_exclusion_group: 'Use only declared options in exclusion groups.',
    unsupported_schema_version: 'This content schema version is not supported.',
  }
  return messages[issue.code] ?? 'Correct this field.'
}

export function closestFocusablePointer(pointer: string): string[] {
  const candidates: string[] = []
  let current = pointer || '/hero/title'
  while (current) {
    candidates.push(current)
    const slash = current.lastIndexOf('/')
    if (slash <= 0) break
    current = current.slice(0, slash)
  }
  return candidates
}
