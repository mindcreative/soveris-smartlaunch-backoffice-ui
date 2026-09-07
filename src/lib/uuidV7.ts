export interface UuidV7Options {
  now?: () => number
  fillRandom?: (target: Uint8Array) => void
}

function defaultFillRandom(target: Uint8Array): void {
  globalThis.crypto.getRandomValues(target)
}

export function createUuidV7(options: UuidV7Options = {}): string {
  const timestamp = (options.now ?? Date.now)()
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp >= 2 ** 48) {
    throw new Error('UUIDv7 timestamp must be an unsigned 48-bit integer')
  }

  const bytes = new Uint8Array(16)
  ;(options.fillRandom ?? defaultFillRandom)(bytes)

  let remaining = timestamp
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = remaining % 256
    remaining = Math.floor(remaining / 256)
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70
  bytes[8] = (bytes[8]! & 0x3f) | 0x80

  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
