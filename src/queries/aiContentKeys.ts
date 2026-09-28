const root = ['backoffice', 'private', 'ai-content'] as const

export const aiContentKeys = {
  all: root,
  client: (clientId: string) => [...root, clientId] as const,
  product: (clientId: string, actorId: string, productId: string) =>
    [...root, clientId, actorId, productId] as const,
  job: (clientId: string, actorId: string, productId: string, jobId: string) =>
    [...root, clientId, actorId, productId, jobId] as const,
}
