import { TrendingUp, ArrowUp, ArrowDown } from 'lucide-react'
interface StatCardProps {
  title: string
  value: string | number
  change?: {
    value: number
    isPositive: boolean
  }
  icon?: React.ReactNode
  loading?: boolean
  className?: string
}

export function StatCard({
  title,
  value,
  change,
  icon,
  loading,
  className = '',
}: StatCardProps) {
  if (loading) {
    return (
      <div className={`bg-surface rounded-lg border border-line p-6 animate-pulse ${className}`}>
        <div className="flex items-center justify-between mb-4">
          <div className="h-4 bg-hover rounded w-20"></div>
          <div className="w-10 h-10 bg-hover rounded-lg"></div>
        </div>
        <div className="h-8 bg-hover rounded w-24 mb-2"></div>
        <div className="h-3 bg-hover rounded w-16"></div>
      </div>
    )
  }

  return (
    <div className={`bg-surface rounded-lg border border-line p-6 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-medium text-muted">{title}</p>
        {icon && (
          <div className="w-10 h-10 bg-selected rounded-lg flex items-center justify-center text-primary">
            {icon}
          </div>
        )}
      </div>
      <p className="text-2xl font-bold text-foreground mb-1">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>
      {change && (
        <p className={`text-xs font-medium ${change.isPositive ? 'text-success' : 'text-danger'}`}>
          {change.isPositive ? <ArrowUp aria-hidden="true" size={16} className="inline" /> : <ArrowDown aria-hidden="true" size={16} className="inline" />}<span className="sr-only">{change.isPositive ? 'Increase' : 'Decrease'}</span> {Math.abs(change.value)}% vs last period
        </p>
      )}
    </div>
  )
}

// Metric card for analytics data
interface MetricCardProps {
  label: string
  value: string
  subtitle?: string
  color?: 'blue' | 'green' | 'purple' | 'orange'
}

const colorMap: Record<string, string> = {
  blue: 'from-primary-solid to-primary-solid',
  green: 'from-success-solid to-success-solid',
  purple: 'from-info-solid to-info-solid',
  orange: 'from-warning-solid to-warning-solid',
}

export function MetricCard({ label, value, subtitle, color = 'blue' }: MetricCardProps) {
  return (
    <div className="bg-surface rounded-lg border border-line p-5">
      <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${colorMap[color]} flex items-center justify-center mb-3`}>
        <TrendingUp aria-hidden="true" className="w-5 h-5 text-on-accent" />
      </div>
      <p className="text-sm text-muted mb-1">{label}</p>
      <p className="text-xl font-bold text-foreground">{value}</p>
      {subtitle && <p className="text-xs text-muted mt-1">{subtitle}</p>}
    </div>
  )
}