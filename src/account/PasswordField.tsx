import { useState } from 'react'
import { ACCOUNT_INPUT_CLASS, ACCOUNT_LINK_CLASS } from './constants/accountLifecycle'
import type { PasswordFieldProps } from './models/accountPresentation'

export function PasswordField({ label = 'Password', value, onChange, newPassword = false, error, errorSummaryId }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false)

  return <div>
    <label htmlFor="password" className="block text-sm font-medium">{label}</label>
    {newPassword && <p id="password-guidance" className="mt-1 text-sm text-muted">Use 15–128 Unicode characters, up to 512 UTF-8 bytes. Spaces and paste are welcome. No control characters or all-whitespace passwords. Common or easily guessed passwords are not accepted.</p>}
    <input id="password" name={newPassword ? 'new-password' : 'password'} type={visible ? 'text' : 'password'}
      autoComplete={newPassword ? 'new-password' : 'current-password'} required value={value}
      onChange={event => onChange(event.target.value)} className={ACCOUNT_INPUT_CLASS}
      aria-invalid={!!error || !!errorSummaryId} aria-describedby={[newPassword ? 'password-guidance' : '', error ? 'password-error' : '', errorSummaryId].filter(Boolean).join(' ') || undefined} />
    {error && <p id="password-error" className="mt-1 text-sm text-danger">{error}</p>}
    <button type="button" aria-controls="password" aria-pressed={visible} onClick={() => setVisible(previous => !previous)} className={ACCOUNT_LINK_CLASS}>
      {visible ? 'Hide password' : 'Show password'}
    </button>
  </div>
}
