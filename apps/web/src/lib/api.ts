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
    throw new Error(message)
  }
  return body
}
