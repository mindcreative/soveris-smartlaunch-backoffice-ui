function groupExactDecimal(value: string): string {
  const negative = value.startsWith('-')
  const unsigned = negative ? value.slice(1) : value
  const [integer, fraction] = unsigned.split('.')
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${negative ? '-' : ''}${grouped}${fraction === undefined ? '' : `.${fraction}`}`
}

export function CreditAmount({ value }: { value: string }) {
  return (
    <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-2">
      <span className="break-all font-mono text-2xl font-semibold tabular-nums text-gray-950">
        {groupExactDecimal(value)}
      </span>
      <span className="text-xs font-medium text-gray-600">abstract credits</span>
    </span>
  )
}
