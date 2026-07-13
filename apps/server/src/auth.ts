import './env.ts'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { Request, Response, NextFunction } from 'express'
import { newId } from '@tittel/shared'
import { pool } from './db.ts'

// Supabase Auth is for tutors only (email+password, Google OAuth); students and
// guests never touch it (magic-link tokens instead — see routes gated by
// studentQuery). The server verifies Supabase JWTs via JWKS and maps
// auth.uid -> users row -> org_id, bootstrapping a fresh org on a tutor's
// first authenticated request. PLAN.md §4.1.
const supabaseUrl = process.env.SUPABASE_URL
const jwks = supabaseUrl
  ? createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`))
  : undefined

export interface TutorAuth {
  supabaseUid: string
  email: string
  userId: string
  orgId: string
  role: 'owner' | 'tutor'
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: TutorAuth
    }
  }
}

export async function requireTutor(req: Request, res: Response, next: NextFunction) {
  const header = req.header('authorization')
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined
  if (!token || !jwks) return res.status(401).json({ error: 'unauthorized' })

  let supabaseUid: string
  let email: string
  try {
    const { payload } = await jwtVerify(token, jwks)
    if (!payload.sub) throw new Error('missing sub')
    supabaseUid = payload.sub
    email = typeof payload.email === 'string' ? payload.email : ''
  } catch {
    return res.status(401).json({ error: 'unauthorized' })
  }

  const { rows } = await pool.query<{ id: string; org_id: string; role: 'owner' | 'tutor' }>(
    'select id, org_id, role from users where supabase_uid = $1',
    [supabaseUid],
  )

  let user = rows[0]
  if (!user) {
    const orgId = newId()
    const userId = newId()
    await pool.query(
      `insert into orgs (id, name, plan, trial_ends_at) values ($1, $2, 'trial', now() + interval '30 days')`,
      [orgId, email ? `${email.split('@')[0]}'s org` : 'New org'],
    )
    await pool.query(
      `insert into users (id, org_id, supabase_uid, email, role) values ($1, $2, $3, $4, 'owner')`,
      [userId, orgId, supabaseUid, email],
    )
    user = { id: userId, org_id: orgId, role: 'owner' }
  }

  req.auth = { supabaseUid, email, userId: user.id, orgId: user.org_id, role: user.role }
  next()
}
