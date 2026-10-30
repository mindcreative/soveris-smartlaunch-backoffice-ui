import { fireEvent, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { accountAdmissionApi } from '../account/accountAdmissionApi'
import { CHALLENGE_MESSAGES } from '../account/constants/turnstile'

export const ADMISSION_FIXTURE = {
  contextId: 'A'.repeat(43), nonce: 'Q'.repeat(43), csrf: 'g'.repeat(43),
  challengeOrigin: 'http://localhost:5190', siteKey: 'fixture-site-key', expiresIn: 300,
}

export function mockAccountAdmission(): void {
  document.getElementById('account-document-frame-policy')?.remove()
  vi.spyOn(accountAdmissionApi, 'context').mockResolvedValue(ADMISSION_FIXTURE)
}

export async function completeAccountChallenge(): Promise<void> {
  const frame = await screen.findByTitle('Complete the account security check') as HTMLIFrameElement
  fireEvent(window, new MessageEvent('message', {
    origin: ADMISSION_FIXTURE.challengeOrigin, source: frame.contentWindow,
    data: { type: CHALLENGE_MESSAGES.success, nonce: ADMISSION_FIXTURE.nonce, token: 'fixture-challenge-token' },
  }))
}
