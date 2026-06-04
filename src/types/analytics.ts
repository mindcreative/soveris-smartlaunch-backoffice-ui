export interface OverviewMetrics {
  totalSubmissions: number
  totalVerified: number
  verificationRate: number
  conversionRate: number
  dateRange: { start: string; end: string }
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