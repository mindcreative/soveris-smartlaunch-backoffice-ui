import { forwardRef } from 'react'
import type { ProductContentValidationIssue } from '../../types/content'
import { closestFocusablePointer, issueMessage, pointerToFieldId } from './productEditorModel'

interface ProductErrorSummaryProps {
  errors: ProductContentValidationIssue[]
}

function focusPointer(pointer: string): void {
  for (const candidate of closestFocusablePointer(pointer)) {
    const element = document.getElementById(pointerToFieldId(candidate))
    if (element instanceof HTMLElement) {
      element.focus()
      element.scrollIntoView?.({ block: 'center' })
      return
    }
  }
}

export const ProductErrorSummary = forwardRef<HTMLDivElement, ProductErrorSummaryProps>(
  function ProductErrorSummary({ errors }, ref) {
    if (errors.length === 0) return null
    return <div ref={ref} tabIndex={-1} role="alert" aria-labelledby="product-errors-title" className="rounded-md border-2 border-danger-line bg-danger-soft p-4 text-danger outline-none focus-visible:ring-2 focus-visible:ring-focus">
      <h3 id="product-errors-title" className="font-semibold">Correct {errors.length} {errors.length === 1 ? 'error' : 'errors'}</h3>
      <ul className="mt-2 list-disc space-y-1 pl-5">{errors.map((error, index) => <li key={`${error.path}-${error.code}-${index}`}>
        <button type="button" onClick={() => focusPointer(error.path)} className="min-h-11 text-left text-sm font-medium underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">{issueMessage(error)}</button>
      </li>)}</ul>
    </div>
  },
)
