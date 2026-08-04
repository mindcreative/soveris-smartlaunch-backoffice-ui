interface BadgeProps {
  children: React.ReactNode
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info' | 'neutral'
  size?: 'sm' | 'md'
  className?: string
}

const variantClasses: Record<string, string> = {
  default: 'bg-blue-100 text-blue-800',
  success: 'bg-green-100 text-green-800',
  warning: 'bg-yellow-100 text-yellow-800',
  error: 'bg-red-100 text-red-800',
  info: 'bg-indigo-100 text-indigo-800',
  neutral: 'bg-gray-100 text-gray-800',
}

const sizeClasses: Record<string, string> = {
  sm: 'text-xs px-2 py-0.5 rounded',
  md: 'text-sm px-2.5 py-0.5 rounded',
}

export function Badge({
  children,
  variant = 'default',
  size = 'md',
  className = '',
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center font-medium ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
    >
      {children}
    </span>
  )
}

// Status badge helper for common use cases
interface StatusBadgeProps {
  status: 'pending' | 'verified' | 'invalid' | 'active' | 'inactive' | 'draft' | 'published'
  className?: string
}

const statusMap: Record<string, { variant: BadgeProps['variant']; label: string }> = {
  pending: { variant: 'warning', label: 'Pending' },
  verified: { variant: 'success', label: 'Verified' },
  invalid: { variant: 'error', label: 'Invalid' },
  active: { variant: 'success', label: 'Active' },
  inactive: { variant: 'neutral', label: 'Inactive' },
  draft: { variant: 'info', label: 'Draft' },
  published: { variant: 'success', label: 'Published' },
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusMap[status] || { variant: 'default', label: status }
  return <Badge variant={config.variant} className={className}>{config.label}</Badge>
}