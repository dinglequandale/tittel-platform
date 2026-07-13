import { createClient } from '@supabase/supabase-js'

// Tutor-only auth (email+password, Google OAuth). Students/guests never touch
// this — magic-link tokens instead (PLAN.md §4.1).
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  console.warn('[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set — auth will fail.')
}

export const supabase = createClient(url ?? '', anonKey ?? '')
