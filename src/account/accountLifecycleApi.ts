import { apiClient } from '../api/apiClient'
import { accountAdmissionApi } from './accountAdmissionApi'
import { ACCOUNT_ENDPOINTS } from './constants/accountLifecycle'
import type { AccountVerificationResponse, CorrectAccountEmailRequest, ForgotAccountPasswordRequest, PendingAccountRequest,
  PendingAccountResponse, RegisterAccountRequest, ResetAccountPasswordRequest, VerifyAccountRequest } from './models/accountLifecycle'

function invalidResponse(): never {
  throw { code: 'account_flow_uncertain', message: 'The account result could not be confirmed.' }
}

async function submit<Response>(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  const response = await apiClient.post<Response>(path, body, { signal, retryOnUnauthorized: false })

  return response.data
}

export const accountLifecycleApi = {
  async proofContext(proof: string, signal?: AbortSignal): Promise<{ authMethod: 'email_password' | 'google'; expiresIn: number; completed: boolean }> {
    const result = await submit<{ authMethod: string; expiresIn: number; completed: boolean }>(ACCOUNT_ENDPOINTS.proofContext, { proof }, signal)

    if (typeof result.completed !== 'boolean' || result.authMethod !== 'email_password' && result.authMethod !== 'google' || !Number.isSafeInteger(result.expiresIn) || result.expiresIn <= 0 || result.expiresIn > 1800) {
      return invalidResponse()
    }

    return { authMethod: result.authMethod, expiresIn: result.expiresIn, completed: result.completed }
  },
  register(request: RegisterAccountRequest, signal?: AbortSignal, csrf?: string): Promise<PendingAccountResponse> {
    return accountAdmissionApi.register(request, signal, csrf)
  },
  async resend(request: PendingAccountRequest, signal?: AbortSignal): Promise<void> {
    const result = await submit<{ status: string }>(ACCOUNT_ENDPOINTS.resend, request, signal)

    if (result?.status !== 'check_email') {
      invalidResponse()
    }
  },
  async correctEmail(request: CorrectAccountEmailRequest, signal?: AbortSignal): Promise<void> {
    const result = await submit<{ status: string }>(ACCOUNT_ENDPOINTS.correctEmail, request, signal)

    if (result?.status !== 'check_email') {
      invalidResponse()
    }
  },
  async verify(request: VerifyAccountRequest, signal?: AbortSignal): Promise<AccountVerificationResponse> {
    const result = await submit<AccountVerificationResponse>(ACCOUNT_ENDPOINTS.verify, request, signal)

    if (result?.status === 'activation_complete' && result.loginRequired === true) {
      return { status: 'activation_complete', loginRequired: true }
    }

    if (result?.status !== 'activated' || !result.session) {
      return invalidResponse()
    }

    return { status: 'activated', session: result.session, nextAction: result.nextAction }
  },
  async forgot(request: ForgotAccountPasswordRequest, signal?: AbortSignal): Promise<void> {
    const result = await submit<{ status: string }>(ACCOUNT_ENDPOINTS.forgot, request, signal)

    if (result?.status !== 'instructions_requested') {
      invalidResponse()
    }
  },
  async reset(request: ResetAccountPasswordRequest, signal?: AbortSignal): Promise<void> {
    const result = await submit<{ status: string; loginRequired: boolean }>(ACCOUNT_ENDPOINTS.reset, request, signal)

    if (result?.status !== 'password_reset' || result.loginRequired !== true) {
      invalidResponse()
    }
  },
}
