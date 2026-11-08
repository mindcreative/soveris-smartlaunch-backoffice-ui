export type Audience = 'workspace' | 'platform' | 'support'

export interface ExperienceRoute {
  audience: Audience
  target: string | null
  allowed: boolean
  redirect?: string
  grant?: string
}
