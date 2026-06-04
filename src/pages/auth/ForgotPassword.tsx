import type { FC } from 'react'

const ForgotPassword: FC = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-full max-w-md p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-slate-900">Forgot Password</h1>
          <p className="text-slate-600 mt-2">Enter your email to receive a reset link</p>
        </div>
        <p className="text-center text-slate-500">Coming soon</p>
      </div>
    </div>
  )
}

export default ForgotPassword