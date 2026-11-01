import { useId } from 'react'
import { ACCOUNT_INPUT_CLASS } from './constants/accountLifecycle'
import type { TotpInputProps } from './models/mfa'

export function TotpInput({ value, onChange, invalid, disabled }: TotpInputProps) {
  const id = useId()

  return <div>
    <label htmlFor={id} className="block text-sm font-medium">Authenticator code</label>
    <input id={id} type="text" name="authenticator-code" inputMode="numeric" autoComplete="one-time-code"
      autoCapitalize="none" spellCheck={false} maxLength={12} required value={value} disabled={disabled}
      onChange={event => onChange(event.target.value.replace(/[ \t\r\n]/g, '').slice(0, 6))}
      aria-invalid={invalid || undefined} aria-describedby={`${id}-help${invalid ? ' mfa-feedback' : ''}`} className={ACCOUNT_INPUT_CLASS} />
    <p id={`${id}-help`} className="mt-2 text-sm text-muted">Enter all six digits, including any leading zero. You can paste the code.</p>
  </div>
}
