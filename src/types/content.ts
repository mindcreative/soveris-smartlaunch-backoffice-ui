import type { SoverisProductContentV1DraftSafeDocument } from '../contracts/product-content/v1/generated/product-content-v1'

/** Canonical, lossless Product Content v1. Future product editing must use this shape. */
export type ProductContentV1 = SoverisProductContentV1DraftSafeDocument

/** Legacy DTO returned by the pre-10.3 generic content endpoints. */
export interface LegacyProductContent {
  id: string
  slug: string
  name: string
  heroHeading: string
  heroSubheading?: string
  features: LegacyFeatureItem[]
  faq: LegacyFaqItem[]
  formSchema: LegacyFormField[]
  seoTitle: string
  seoDescription: string
  clientId: string
}

export interface LegacyFeatureItem {
  title: string
  description: string
  icon?: string
}

export interface LegacyFaqItem {
  question: string
  answer: string
}

export interface LegacyFormField {
  name: string
  type: 'text' | 'email' | 'tel' | 'select'
  label: string
  required: boolean
  options?: string[]
}

export interface ProductSummary {
  id: string
  slug: string
  name: string
  status: string
  themeLayout?: string
  updatedAt?: string
  imageCount?: number
  hasContent?: boolean
}

export interface LegacyUpdateContentRequest {
  heroHeading: string
  heroSubheading?: string
  features: LegacyFeatureItem[]
  faq: LegacyFaqItem[]
  formSchema: LegacyFormField[]
  seoTitle: string
  seoDescription: string
}

export interface ImageItem {
  id: string
  url: string
  alt?: string
  assignedAt: string
}
