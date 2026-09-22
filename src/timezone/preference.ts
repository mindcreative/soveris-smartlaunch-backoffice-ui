/** IANA choices for the required create-user field. The backend validates the selection. */
export function timeZoneOptions(): string[] {
  try {
    const supportedValuesOf = (Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf
    const supported = typeof supportedValuesOf === 'function' ? supportedValuesOf('timeZone') : []
    return ['UTC', ...supported.filter((id) => id !== 'UTC')]
  } catch {
    return ['UTC']
  }
}
