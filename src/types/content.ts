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

export interface PublishProductContentRequest {
  expectedDraftRevision: number
  expectedRevision: number
}

export interface ProductContentPublicationResult {
  productId: string
  schemaVersion: number
  revision: number
  content: ProductContentV1
  publicationStatus: 'published'
  draft: ProductContentDraft
}

export interface ProductCompleteness {
  isComplete: boolean
  missingRequirements: string[]
}

export type ProductLifecycleStatus = 'active' | 'archived'
export type ProductPublicationStatus = 'draft' | 'published'

export interface Product {
  id: string
  clientId: string
  slug: string
  name: string
  status: ProductLifecycleStatus
  publicationStatus: ProductPublicationStatus
  revision: number
  contentSchemaVersion: number | null
  contentRevision: number
  draftSchemaVersion: number | null
  draftRevision: number
  completeness: ProductCompleteness
  canonicalUrl: string | null
  createdAt: string
  updatedAt: string
}

export interface ProductPage {
  items: Product[]
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
}

export interface ProductFilters {
  page?: number
  pageSize?: number
  status?: ProductLifecycleStatus | 'all'
  publication?: ProductPublicationStatus | 'all'
  search?: string
  sort?: 'name' | 'slug' | 'createdAt' | 'updatedAt'
  direction?: 'asc' | 'desc'
}

export interface CreateProductRequest {
  operationId: string
  name: string
  slug: string
}

export interface UpdateProductRequest extends CreateProductRequest {
  expectedRevision: number
  status: ProductLifecycleStatus
}

export type ProductSummary = Product

export interface ImageItem {
  id: string
  url: string
  alt?: string
  assignedAt: string
}
