export interface ProductContent {
  id: string
  slug: string
  name: string
  heroHeading: string
  heroSubheading?: string
  features: FeatureItem[]
  faq: FaqItem[]
  formSchema: FormField[]
  seoTitle: string
  seoDescription: string
  clientId: string
}

export interface FeatureItem {
  title: string
  description: string
  icon?: string
}

export interface FaqItem {
  question: string
  answer: string
}

export interface FormField {
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

export interface UpdateContentRequest {
  heroHeading: string
  heroSubheading?: string
  features: FeatureItem[]
  faq: FaqItem[]
  formSchema: FormField[]
  seoTitle: string
  seoDescription: string
}

export interface ImageItem {
  id: string
  url: string
  alt?: string
  assignedAt: string
}
