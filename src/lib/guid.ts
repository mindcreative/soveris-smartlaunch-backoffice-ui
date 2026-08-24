const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function canonicalizeGuid(value: string | undefined): string | null {
  if (!value || !GUID_PATTERN.test(value)) {
    return null
  }

  return value.toLowerCase()
}
