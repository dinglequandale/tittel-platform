import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Field, Input } from '@tittel/ui'
import { BRAND_NAME } from '@tittel/shared'
import { supabase } from '../lib/supabase.ts'

// Signing up only creates the Supabase Auth user; the org + users row is
// bootstrapped server-side on first authenticated request (apps/server/src/auth.ts).
export function Signup() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    const { error } = await supabase.auth.signUp({ email, password })
    setBusy(false)
    if (error) return setError(error.message)
    navigate('/app')
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <h1 className="font-display text-2xl">{BRAND_NAME}</h1>
      <p className="text-sm text-ink-2">30-day trial, no card required.</p>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field label="Email">
          <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" error={error}>
          <Input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" disabled={busy}>
          {busy ? 'Creating account…' : 'Start trial'}
        </Button>
      </form>
      <p className="text-sm text-ink-2">
        Already have an account? <Link className="text-accent" to="/login">Sign in</Link>
      </p>
    </main>
  )
}
