import type { AiJobStatusDto, AiRetainedAttempt } from '../../types/aiContent'

interface ProductContentPreviewProps {
  attempt: AiRetainedAttempt
  job: AiJobStatusDto
  draftMoved: boolean
}

export function ProductContentPreview({ attempt, job, draftMoved }: ProductContentPreviewProps) {
  if (!job.result) return null
  const imagePrompt = attempt.material.target === 'image_prompt'
  return <section aria-labelledby="ai-preview-heading" className="space-y-4 rounded-lg border border-indigo-300 bg-indigo-50 p-4 forced-colors:border-[CanvasText]">
    <div>
      <h4 id="ai-preview-heading" className="font-semibold text-gray-950">{imagePrompt ? 'Image prompt preview' : 'Current and generated preview'}</h4>
      <p className="mt-1 text-sm text-gray-700">Read-only saved result. No product content has been changed.</p>
    </div>
    {draftMoved && <p role="status" className="rounded-md border border-amber-500 bg-amber-50 p-3 text-sm text-amber-950">The working draft has moved on. The comparison below is “Current at generation start”.</p>}
    <div className="grid min-w-0 gap-4 lg:grid-cols-2">
      <section aria-labelledby="ai-current-heading" className="min-w-0 rounded-md border border-gray-300 bg-white p-3">
        <h5 id="ai-current-heading" className="font-medium">{draftMoved ? 'Current at generation start' : 'Current'}</h5>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm text-gray-800">{attempt.material.currentValue || 'No current text'}</p>
      </section>
      <section aria-labelledby="ai-generated-heading" className="min-w-0 rounded-md border border-gray-300 bg-white p-3">
        <h5 id="ai-generated-heading" className="font-medium">{imagePrompt ? 'Generated image prompts (text)' : 'Generated'}</h5>
        <ol className="mt-2 space-y-3">
          {job.result.variations.map((variation, index) => <li key={`${job.result!.resultId}:${index}`} className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Variation {index + 1}</p>
            <output className="mt-1 block whitespace-pre-wrap break-words text-sm text-gray-950">{variation}</output>
          </li>)}
        </ol>
      </section>
    </div>
  </section>
}
