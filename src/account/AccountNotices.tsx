import { accountNoticeUrl } from './accountNotices'
import { ACCOUNT_LINK_CLASS } from './constants/accountLifecycle'

export function AccountNotices() {
  const mode = import.meta.env.VITE_ACCOUNT_NOTICE_MODE
  const terms = accountNoticeUrl(import.meta.env.VITE_ACCOUNT_TERMS_URL, mode)
  const privacy = accountNoticeUrl(import.meta.env.VITE_ACCOUNT_PRIVACY_URL, mode)

  return <div className="text-sm text-muted">
    {terms ? <a href={terms} rel="noreferrer" className={ACCOUNT_LINK_CLASS}>Account Terms</a> : <p>Account Terms are currently unavailable.</p>}
    {privacy ? <a href={privacy} rel="noreferrer" className={ACCOUNT_LINK_CLASS}>Account Privacy notice</a> : <p>Account Privacy notice is currently unavailable.</p>}
    {(!terms || !privacy) && <p>Public registration approval remains open.</p>}
  </div>
}
