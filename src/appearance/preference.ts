export type AppearancePreference = 'system' | 'light' | 'dark'
export type AppearanceMode = 'light' | 'dark'
export const APPEARANCE_KEY_PREFIX = 'soveris-smartlaunch-appearance:user:'
export const appearanceKey = (userId: string) => `${APPEARANCE_KEY_PREFIX}${encodeURIComponent(userId)}`
export const DARK_QUERY = '(prefers-color-scheme: dark)'

// Keep the small prepaint bootstrap contract aligned; appearance.spec exercises
// the built script with invalid values, blocked storage and opposite OS choices.
export function normalizePreference(value: unknown): AppearancePreference {
  return value === 'light' || value === 'dark' ? value : 'system'
}
export function readPreference(userId: string | null): AppearancePreference {
  if (!userId) return 'system'
  try { return normalizePreference(window.localStorage.getItem(appearanceKey(userId))) }
  catch { return 'system' }
}
export function savePreference(userId: string, value: AppearancePreference): boolean {
  try { window.localStorage.setItem(appearanceKey(userId), value); return true }
  catch { return false }
}
export function systemMedia(): MediaQueryList | undefined {
  try { return window.matchMedia?.(DARK_QUERY) }
  catch { return undefined }
}
export function resolveMode(preference: AppearancePreference, systemDark: boolean): AppearanceMode {
  return preference === 'system' ? systemDark ? 'dark' : 'light' : preference
}
export function applyMode(mode: AppearanceMode) {
  document.documentElement.dataset.theme = mode
  document.documentElement.style.colorScheme = mode
}
