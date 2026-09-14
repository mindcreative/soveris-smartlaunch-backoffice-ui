import { useEffect, useRef, useState } from 'react'
import type { ApiError } from '../../api/apiClient'
import { createUuidV7 } from '../../lib/uuidV7'
import { useCreateProduct } from '../../queries/productQueries'
import type { Product } from '../../types/content'
import { Modal } from '../shared/Modal'

interface ProductCreateModalProps {
  clientId: string
  isOpen: boolean
  onClose: () => void
  onCreated: (product: Product) => void
}

function errorMessage(error: unknown): string {
  const apiError = error as ApiError | undefined
  switch (apiError?.code) {
    case 'slug_conflict':
    case 'product_slug_conflict': return 'That slug is already used by another product for this Client.'
    case 'limit_reached': return 'This Client has reached its active product limit.'
    case 'configuration_unavailable': return 'Product limits are temporarily unavailable. Try again later.'
    case 'transition_pending': return 'A Client access change is still being applied. Try again shortly.'
    case 'insufficient_permissions': return 'You no longer have permission to create products.'
    case 'NETWORK_ERROR': return 'The result is uncertain because the network request failed. Retry uses the same operation identity.'
    default: return apiError?.message || 'The product could not be created.'
  }
}

export function ProductCreateModal({ clientId, isOpen, onClose, onCreated }: ProductCreateModalProps) {
  const create = useCreateProduct(clientId)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const operationIdRef = useRef(createUuidV7())
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) create.reset()
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    if (create.isPending) return
    setName('')
    setSlug('')
    operationIdRef.current = createUuidV7()
    create.reset()
    onClose()
  }

  const changeCommand = (change: () => void) => {
    if (create.error) {
      operationIdRef.current = createUuidV7()
      create.reset()
    }
    change()
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim() || !slug.trim() || create.isPending) return
    try {
      const product = await create.mutateAsync({
        operationId: operationIdRef.current,
        name: name.trim(),
        slug: slug.trim().toLowerCase(),
      })
      setName('')
      setSlug('')
      operationIdRef.current = createUuidV7()
      onCreated(product)
    } catch {
      // Mutation state renders durable guidance while preserving input and identity.
    }
  }

  return <Modal isOpen={isOpen} onClose={close} closeDisabled={create.isPending} title="Create product" initialFocusRef={nameRef} footer={<div className="flex flex-wrap justify-end gap-3">
    <button type="button" onClick={close} disabled={create.isPending} className="min-h-11 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:opacity-50">Cancel</button>
    <button type="submit" form="create-product-form" disabled={create.isPending || !name.trim() || !slug.trim()} className="min-h-11 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 disabled:opacity-50">{create.isPending ? 'Creating product…' : 'Create product'}</button>
  </div>}>
    <form id="create-product-form" onSubmit={submit} className="space-y-4">
      <p className="text-sm text-gray-600">Creation reserves an active product slot and starts unpublished. It does not call AI.</p>
      {create.error && <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">{errorMessage(create.error)}</div>}
      <div><label htmlFor="create-product-name" className="block text-sm font-medium text-gray-900">Product name</label><input ref={nameRef} id="create-product-name" value={name} maxLength={128} required onChange={(event) => changeCommand(() => setName(event.target.value))} className="mt-1 min-h-11 w-full rounded-md border border-gray-300 px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600" /></div>
      <div><label htmlFor="create-product-slug" className="block text-sm font-medium text-gray-900">Product slug</label><p id="create-product-slug-help" className="text-xs text-gray-600">Lowercase letters, numbers and single hyphens.</p><input id="create-product-slug" value={slug} maxLength={64} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" aria-describedby="create-product-slug-help" required onChange={(event) => changeCommand(() => setSlug(event.target.value))} className="mt-1 min-h-11 w-full rounded-md border border-gray-300 px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600" /></div>
      {create.isPending && <p role="status">Creating product…</p>}
    </form>
  </Modal>
}
