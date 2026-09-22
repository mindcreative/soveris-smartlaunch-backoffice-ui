import type { ReactNode } from 'react'

export type LocalInstantValue = string

const WALL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6})$/

export function normalizeLocalWallInput(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?$/.exec(value)
  if (!match) throw new Error('Invalid local date and time')
  const wall = `${match[1]}:${match[2] ?? '00'}.${(match[3] ?? '').padEnd(6, '0')}`
  return parseLocalInstant(wall)
}

export function parseLocalInstant(value: unknown): LocalInstantValue {
  if (typeof value !== 'string') throw new Error('Invalid local date and time')
  const match = WALL.exec(value)
  if (!match) throw new Error('Invalid local date and time')
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number)
  const probe = new Date(0)
  probe.setUTCFullYear(year!, month! - 1, day!)
  probe.setUTCHours(hour!, minute!, second!, 0)
  if (year! < 1 || probe.getUTCFullYear() !== year ||
      probe.getUTCMonth() !== month! - 1 || probe.getUTCDate() !== day ||
      probe.getUTCHours() !== hour || probe.getUTCMinutes() !== minute ||
      probe.getUTCSeconds() !== second)
    throw new Error('Invalid local date and time')
  return value
}

export function localInstantDateTime(value: LocalInstantValue): string {
  return parseLocalInstant(value)
}

export function localInstantLabel(value: LocalInstantValue): string {
  return parseLocalInstant(value).replace('T', ' ')
}

export function LocalInstant({ value, children }: {
  value: LocalInstantValue
  children?: ReactNode
}) {
  const parsed = parseLocalInstant(value)
  return <time dateTime={parsed}>{children ?? localInstantLabel(parsed)}</time>
}
