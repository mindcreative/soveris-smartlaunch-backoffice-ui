import { LocalInstant, parseLocalInstant } from './LocalInstant'

/** Displays a date already projected into the authenticated user's saved zone. */
export function SavedZoneTime({ value }: { value: string }) {
  return <LocalInstant value={parseLocalInstant(value)} />
}
