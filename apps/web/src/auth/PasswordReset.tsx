import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Field, Input } from '@tittel/ui'
import { supabase } from '../lib/supabase.ts'
import { AuthLayout } from './AuthLayout.tsx'

// Forgot password: Supabase emails a link back to /reset, which opens with a
// recovery session; the tutor sets a new password there.
export function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset` })
    setBusy(false)
    if (error) return setError(error.message)
    setSent(true)
  }

  if (sent) {
    return (
      <AuthLayout title="Check your inbox" lede={`If ${email} has an account, a link to set a new password is on its way.`}
        footer={<Link to="/login">Back to sign in</Link>} />
    )
  }
  return (
    <AuthLayout title="Forgot your password?" lede="We'll email you a link to set a new one."
      footer={<Link to="/login">Back to sign in</Link>}>
      <form onSubmit={onSubmit} className="auth-form">
        <Field label="Email" error={error}>
          <Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send the link'}</Button>
      </form>
    </AuthLayout>
  )
}

export function ResetPassword() {
  const navigate = useNavigate()
  const [ready, setReady] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  // The emailed link signs the tutor in for recovery; wait for that session.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { if (data.session) setReady(true) })
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) setReady(true)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) return setError(error.message)
    navigate('/app')
  }

  return (
    <AuthLayout title="Set a new password" lede={ready ? undefined : 'Open this page from the link in your email.'}
      footer={<Link to="/forgot">Send a new link</Link>}>
      {ready && (
        <form onSubmit={onSubmit} className="auth-form">
          <Field label="New password" error={error}>
            <Input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save and sign in'}</Button>
        </form>
      )}
    </AuthLayout>
  )
}

/**
 * Sign in with Google, once Google is switched on in Supabase (Authentication
 * → Providers) and VITE_GOOGLE_AUTH=on is set, so the button never leads to
 * a "provider not enabled" error.
 */
export function GoogleButton({ label }: { label: string }) {
  const [error, setError] = useState<string>()
  if (import.meta.env.VITE_GOOGLE_AUTH !== 'on') return null
  return (
    <>
      <div className="auth-or"><span>or</span></div>
      <Button variant="secondary" type="button" onClick={async () => {
        const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/app` } })
        if (error) setError(error.message)
      }}>{label}</Button>
      {error && <p className="field-error">{error}</p>}
    </>
  )
}
