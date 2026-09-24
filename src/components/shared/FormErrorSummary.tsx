import { forwardRef, useId } from 'react'

export interface FormFieldError {
  fieldId: string
  label: string
  message: string
}

export const FormErrorSummary = forwardRef<HTMLDivElement, { errors: FormFieldError[] }>(
  function FormErrorSummary({ errors }, ref) {
    const titleId = useId()
    if (errors.length === 0) return null
    return (
      <div
        ref={ref}
        role="alert"
        tabIndex={-1}
        aria-labelledby={titleId}
        className="rounded-md border-2 border-red-700 bg-red-50 p-4 text-sm text-red-950 outline-none focus-visible:ring-2 focus-visible:ring-red-700"
      >
        <h3 id={titleId} className="font-semibold">
          Correct the following before continuing
        </h3>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {errors.map((error) => (
            <li key={error.fieldId}>
              <a
                href={`#${error.fieldId}`}
                className="inline-flex min-h-11 items-center underline decoration-2 underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700"
                onClick={(event) => {
                  event.preventDefault()
                  document.getElementById(error.fieldId)?.focus()
                }}
              >
                {error.label}: {error.message}
              </a>
            </li>
          ))}
        </ul>
      </div>
    )
  }
)
