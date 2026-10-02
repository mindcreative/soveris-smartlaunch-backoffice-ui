import { useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { isCanonicalUuidV7 } from '../../api/aiImageApi'
import { AiImageJobTracker } from '../../components/ai/AiImageJobTracker'
import { AiImageSubmissionForm } from '../../components/ai/AiImageSubmissionForm'
import { presentAiImageCapability } from '../../components/ai/aiImageCapability'
import { useAuth } from '../../hooks/useAuth'
import { canonicalizeGuid } from '../../lib/guid'
import { useClientCapabilities } from '../../queries/billingQueries'
import { useAiImageAdmission } from '../../queries/aiImageQueries'

function InvalidJobRoute() {
  return (
    <section className="mx-auto max-w-3xl rounded-lg border border-red-700 bg-red-50 p-5 text-red-950" role="alert">
      <h1 className="text-xl font-semibold">Invalid image Job link</h1>
      <p className="mt-2">The route must contain one canonical lowercase UUIDv7 Job ID. No server request was made.</p>
    </section>
  )
}

function SubmissionPage({ clientId }: { clientId: string }) {
  const navigate = useNavigate()
  const { user, hasPermission } = useAuth()
  const capabilities = useClientCapabilities(clientId)
  const hasCreate = hasPermission('ai:create')
  const presentation = useMemo(
    () => presentAiImageCapability(capabilities.data, hasCreate),
    [capabilities.data, hasCreate],
  )
  const capabilityLoading = capabilities.isLoading || capabilities.isFetching
  const admission = useAiImageAdmission({
    actorId: user?.id ?? '', clientId,
    authorized: hasCreate && presentation.capabilityEligible && !capabilityLoading,
  })
  useEffect(() => {
    if (admission.state.phase === 'acknowledged' && admission.state.receipt)
      navigate(`/ai/image-jobs/${admission.state.receipt.jobId}`, { replace: false })
  }, [admission.state.phase, admission.state.receipt, navigate])
  return (
    <div className="mx-auto min-w-0 max-w-4xl space-y-5">
      <header>
        <h1 className="text-2xl font-semibold text-gray-950">AI image generation</h1>
        <p className="mt-1 text-sm text-gray-700">Submit and track one private generated image without exposing processing internals.</p>
      </header>
      <AiImageSubmissionForm
        key={`${user?.id ?? 'anonymous'}:${clientId}`}
        clientId={clientId}
        capability={presentation}
        capabilityLoading={capabilityLoading}
        admission={admission}
      />
    </div>
  )
}

export function AiImageJobsPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const { user } = useAuth()
  const clientId = canonicalizeGuid(user?.clientId)
  if (!clientId) return <InvalidJobRoute />
  if (jobId !== undefined) {
    if (!isCanonicalUuidV7(jobId)) return <InvalidJobRoute />
    return <AiImageJobTracker key={`${user?.id ?? 'anonymous'}:${clientId}:${jobId}`} clientId={clientId} jobId={jobId} />
  }
  return <SubmissionPage clientId={clientId} />
}
