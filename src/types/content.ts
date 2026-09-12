import type { SoverisProductContentV1DraftSafeDocument } from '../contracts/product-content/v1/generated/product-content-v1'

/** Canonical, lossless Product Content v1. Future product editing must use this shape. */
export type ProductContentV1 = SoverisProductContentV1DraftSafeDocument

export type EmptyProductContent = Record<string, never>

export interface ProductContentDraft {
  schemaVersion: number
  revision: number
  content: ProductContentV1
}

export interface ProductContentEnvelope {
  productId: string
  schemaVersion: number | null
  revision: number
  content: ProductContentV1 | EmptyProductContent
  draft?: ProductContentDraft
}

export interface ProductContentValidationIssue {
  path: string
  keyword: string
  code: string
  message: string
}

export interface ProductContentWarning {
  path: string
  code: string
  message: string
}

export interface ProductContentValidationReport {
  schemaVersion: number
  isValid: boolean
  errors: ProductContentValidationIssue[]
  warnings: ProductContentWarning[]
}

export interface ValidateProductContentRequest {
  schemaVersion: number
  content: ProductContentV1
  target: 'draft' | 'publish'
}

export interface SaveProductContentDraftRequest {
  schemaVersion: number
  expectedRevision: number
  content: ProductContentV1
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

export interface ImageItem {
  id: string
  url: string
  alt?: string
  assignedAt: string
}
