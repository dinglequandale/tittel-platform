import { supabase } from './supabase.ts'

// Thin JSON fetch wrapper for /api/tutor/*. Attaches the current Supabase
// session's access token; student/guest surfaces use their portal token in
// the URL instead and don't need this.
export async function apiFetch(path: string, init: RequestInit = {}) {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token

  const res = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  })
  if (res.status === 204) return null
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const message = typeof body?.error === 'string' ? body.error : `${res.status} ${res.statusText}`
    const err = new Error(message) as Error & { status: number }
    err.status = res.status
    throw err
  }
  return body
}

/** Error copy for a student/guest magic link: a 404 means the link itself is dead. */
export function linkErrorMessage(err: unknown): string {
  if ((err as { status?: number }).status === 404) {
    return "This link isn't active anymore. Ask your tutor for a new one."
  }
  return (err as Error).message
}
