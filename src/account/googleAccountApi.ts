import type { SignupChallengeAdmission } from './models/turnstile'
import { ACCOUNT_ADMISSION } from './constants/turnstile'
import { normalizeAccountError } from './accountLifecycleError'
import { ACCOUNT_PROOF_PATTERN } from './constants/accountLifecycle'
import { GOOGLE_ACCOUNT } from './constants/googleAccount'
import type { GoogleCompletion, GoogleContext, GoogleIntent, GoogleStart } from './models/googleAccount'

function invalidResponse(): never {
  throw normalizeAccountError({ code: 'account_flow_uncertain' })
}

async function request(path: string, body?: unknown, signal?: AbortSignal, headers: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const deadline = AbortSignal.timeout(GOOGLE_ACCOUNT.deadlineMilliseconds)
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline

  try {
    const response = await fetch(GOOGLE_ACCOUNT.prefix + path, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
      redirect: 'error', referrerPolicy: 'no-referrer', signal: combined,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const reader = response.body?.getReader()
    const decoder = new TextDecoder()
    let bytes = 0
    let text = ''

    if (!reader) {
      return invalidResponse()
    }

    while (true) {
      const block = await reader.read()

      if (block.done) {
        break
      }

      bytes += block.value.byteLength

      if (bytes > GOOGLE_ACCOUNT.maximumResponseBytes) {
        await reader.cancel()

        return invalidResponse()
      }

      text += decoder.decode(block.value, { stream: true })
    }

    text += decoder.decode()
    let result: unknown

    try {
      result = JSON.parse(text)
    } catch {
      throw normalizeAccountError(null, response.status)
    }

    if (!response.ok) {
      throw normalizeAccountError(result, response.status, response.headers.get('Retry-After'))
    }

    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      return invalidResponse()
    }

    return result as Record<string, unknown>
  } catch (failure) {
    const safe = failure && typeof failure === 'object' && 'code' in failure ? failure : null

    throw normalizeAccountError(safe, safe && 'status' in safe && typeof safe.status === 'number' ? safe.status : undefined,
      safe && 'retryAfterSeconds' in safe ? safe.retryAfterSeconds : undefined)
  }
}

async function context(signal?: AbortSignal): Promise<GoogleContext> {
  const result = await request('/context', undefined, signal)

  if (result.enabled !== true || typeof result.csrf !== 'string' || !ACCOUNT_PROOF_PATTERN.test(result.csrf) ||
    typeof result.expiresIn !== 'number' || !Number.isSafeInteger(result.expiresIn) || result.expiresIn <= 0 || result.expiresIn > GOOGLE_ACCOUNT.maximumSeconds) {
    return invalidResponse()
  }

  return { csrf: result.csrf, expiresIn: result.expiresIn, enabled: true }
}

async function submit(path: string, body: unknown, signal?: AbortSignal, accessToken?: string, additionalHeaders: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const browser = await context(signal)

  return request(path, body, signal, { 'X-Account-CSRF': browser.csrf, ...additionalHeaders,
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) })
}

export const googleAccountApi = {
  async start(intent: GoogleIntent, proof?: string, signal?: AbortSignal, admission?: SignupChallengeAdmission): Promise<GoogleStart> {
    const signup = intent === 'signup' ? admission : undefined
    const result = await submit('/start', { intent, ...(proof ? { proof } : {}),
      ...(signup ? { admissionContext: signup.contextId, turnstileToken: signup.token } : {}) }, signal, undefined,
      signup ? { [ACCOUNT_ADMISSION.csrfHeader]: signup.csrf } : {})

    if (typeof result.authorizationUrl !== 'string' || result.authorizationUrl.length > 8192 || typeof result.expiresIn !== 'number' ||
      !Number.isSafeInteger(result.expiresIn) || result.expiresIn <= 0 || result.expiresIn > GOOGLE_ACCOUNT.maximumSeconds) {
      return invalidResponse()
    }

    let url: URL

    try {
      url = new URL(result.authorizationUrl)
    } catch {
      return invalidResponse()
    }

    if (url.origin !== GOOGLE_ACCOUNT.authorizationOrigin || url.pathname !== GOOGLE_ACCOUNT.authorizationPath ||
      url.username || url.password || url.hash || url.searchParams.get('response_type') !== 'code' ||
      url.searchParams.get('response_mode') !== 'form_post' || url.searchParams.get('code_challenge_method') !== 'S256') {
      return invalidResponse()
    }

    return { authorizationUrl: result.authorizationUrl, expiresIn: result.expiresIn }
  },
  async complete(signal?: AbortSignal): Promise<GoogleCompletion> {
    const result = await submit('/complete', {}, signal)

    if ((result.status === 'authenticated' || (result.status === 'activated' && result.nextAction === 'create_first_product')) && result.session) {
      return result as unknown as GoogleCompletion
    }

    if (result.status === 'check_email' && result.authMethod === 'google' && typeof result.pendingToken === 'string' &&
      ACCOUNT_PROOF_PATTERN.test(result.pendingToken) && Number.isSafeInteger(result.expiresIn) &&
      typeof result.expiresIn === 'number' && result.expiresIn > 0 && result.expiresIn <= 86400) {
      return { status: 'check_email', authMethod: 'google', pendingToken: result.pendingToken, expiresIn: result.expiresIn }
    }

    if (result.status === 'link_required' || result.status === 'signup_required' || result.status === 'cancelled') {
      return { status: result.status }
    }

    if (result.status === 'login_required' && result.loginRequired === true) {
      return { status: 'login_required', loginRequired: true }
    }

    return invalidResponse()
  },
  async cancel(pendingToken?: string, signal?: AbortSignal): Promise<void> {
    const result = await submit('/cancel', pendingToken ? { pendingToken } : {}, signal)

    if (result.status !== 'cancelled') {
      invalidResponse()
    }
  },
  async linkProof(password: string, accessToken: string, signal?: AbortSignal): Promise<string> {
    const result = await submit('/link-proof', { password }, signal, accessToken)

    if (typeof result.proof !== 'string' || !ACCOUNT_PROOF_PATTERN.test(result.proof)) {
      return invalidResponse()
    }

    return result.proof
  },
  async link(proof: string, accessToken: string, signal?: AbortSignal): Promise<void> {
    const result = await submit('/link', { proof, confirm: true }, signal, accessToken)

    if (result.status !== 'login_required' || result.loginRequired !== true) {
      invalidResponse()
    }
  },
}
