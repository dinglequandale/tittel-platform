import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Field, Input } from '@tittel/ui'
import { supabase } from '../lib/supabase.ts'
import { AuthLayout } from './AuthLayout.tsx'
import { GoogleButton } from './PasswordReset.tsx'

// Signing up only creates the Supabase Auth user; the org + users row is
// bootstrapped server-side on first authenticated request (apps/server/src/auth.ts).
export function Signup() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [business, setBusiness] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [checkInbox, setCheckInbox] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    // Their name and business name ride along as user metadata; the server
    // reads them when it sets up the workspace (apps/server/src/auth.ts).
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: { data: { display_name: name.trim(), org_name: business.trim() } },
    })
    setBusy(false)
    if (error) return setError(error.message)
    if (!data.session) {
      setCheckInbox(true)
      return
    }
    navigate('/app')
  }

  if (checkInbox) {
    return <AuthLayout title="Check your inbox" lede={`We sent a confirmation link to ${email}.`} />
  }

  return (
    <AuthLayout
      title="Start your trial"
      lede="30 days, everything included, no card required."
      footer={<>Already have an account? <Link to="/login">Sign in</Link></>}
    >
      <form onSubmit={onSubmit} className="auth-form">
        <Field label="Your name">
          <Input required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Business name (optional)" hint="Shown to students and parents. Your name is used if blank.">
          <Input autoComplete="organization" value={business} onChange={(e) => setBusiness(e.target.value)} />
        </Field>
        <Field label="Email">
          <Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" error={error}>
          <Input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" disabled={busy}>
          {busy ? 'Creating account…' : 'Start trial'}
        </Button>
        <GoogleButton label="Sign up with Google" />
        <p className="auth-legal">
          By signing up you agree to the <Link to="/terms">Terms</Link> and <Link to="/privacy">Privacy Policy</Link>.
        </p>
      </form>
    </AuthLayout>
  )
}
