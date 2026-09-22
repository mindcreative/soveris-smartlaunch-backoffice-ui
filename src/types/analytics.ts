export interface OverviewMetrics {
  totalSubmissions: number
  verifiedSubmissions: number
  verificationRate: number
  conversionRate: number
  totalPageViews: number
  fromDate: string | null
  toDate: string | null
}

export interface FunnelStageCount {
  stage: string
  count: number
  percentage: number
}

export interface GeographyData {
  country: string
  city: string
  count: number
}

export interface TrendPoint {
  date: string
  value: number
  label: string
}

export interface TrafficSource {
  source: string
  count: number
  percentage: number
}

export interface ProductBreakdown {
  productId: string
  productName: string
  submissions: number
  verified: number
  conversionRate: number
}
