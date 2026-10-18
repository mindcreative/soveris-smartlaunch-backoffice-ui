import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { applyMode, readPreference, resolveMode, savePreference, systemMedia, type AppearancePreference, type AppearanceMode } from './preference'

interface Appearance {
  preference: AppearancePreference
  mode: AppearanceMode
  setPreference: (value: AppearancePreference) => void
  saveFailed: boolean
}
const AppearanceContext = createContext<Appearance | null>(null)

const loadChoice = (userId: string | null) => ({ userId, preference: readPreference(userId), saveFailed: false })

export function AppearanceProvider({ children, userId }: { children: ReactNode; userId: string | null }) {
  const [choice, setChoice] = useState(() => loadChoice(userId))
  // Reset during render so neither the previous account's mode nor its save
  // error can reach a committed frame. Do not key/remount the business subtree.
  let current = choice
  if (choice.userId !== userId) {
    current = loadChoice(userId)
    setChoice(current)
  }
  const { preference, saveFailed } = current
  const [media] = useState(systemMedia)
  const [systemDark, setSystemDark] = useState(() => media?.matches ?? false)
  const mode = resolveMode(preference, systemDark)
  useLayoutEffect(() => { applyMode(mode) }, [mode])
  useEffect(() => {
    if (!media) return
    const update = () => setSystemDark(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [media])
  const value = useMemo<Appearance>(() => ({
    preference, mode, saveFailed,
    setPreference(next) {
      if (!userId) return
      // Apply even when persistence fails. Never key the business subtree by mode.
      applyMode(resolveMode(next, media?.matches ?? false))
      setSystemDark(media?.matches ?? false)
      setChoice({ userId, preference: next, saveFailed: !savePreference(userId, next) })
    },
  }), [preference, mode, saveFailed, media, userId])
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>
}
export function useAppearance() {
  const value = useContext(AppearanceContext)
  if (!value) throw new Error('AppearanceProvider is required')
  return value
}
