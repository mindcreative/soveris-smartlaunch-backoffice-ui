const root = ['backoffice', 'private', 'ai-images'] as const

export const aiImageKeys = {
  all: root,
  client: (clientId: string) => [...root, clientId] as const,
  actor: (clientId: string, actorId: string) => [...root, clientId, actorId] as const,
  job: (clientId: string, actorId: string, jobId: string) => [...root, clientId, actorId, jobId] as const,
}
