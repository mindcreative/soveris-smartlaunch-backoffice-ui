function groupExactDecimal(value: string): string {
  const negative = value.startsWith('-')
  const unsigned = negative ? value.slice(1) : value
  const [integer, fraction] = unsigned.split('.')
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${negative ? '-' : ''}${grouped}${fraction === undefined ? '' : `.${fraction}`}`
}

interface CreditAmountProps {
  value: string
  signed?: boolean
  compact?: boolean
}

export function CreditAmount({ value, signed = false, compact = false }: CreditAmountProps) {
  const grouped = groupExactDecimal(value)
  const displayed = signed && !value.startsWith('-') ? `+${grouped}` : grouped
  return (
    <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-2">
      <span className={`break-all font-mono font-semibold tabular-nums text-gray-950 ${compact ? 'text-sm' : 'text-2xl'}`}>
        {displayed}
      </span>
      <span className="text-xs font-medium text-gray-600">abstract credits</span>
    </span>
  )
}
