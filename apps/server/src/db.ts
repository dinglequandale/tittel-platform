import './env.ts'
import { Pool } from 'pg'
import type { QueryResultRow } from 'pg'

// Single shared connection pool. DATABASE_URL is the Supabase Postgres URI —
// use the session-pooler URL on Render (PLAN.md §9.5), direct host is
// IPv6-only on the free tier.
const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  console.warn(
    '[db] DATABASE_URL is not set — DB queries will fail until you configure it (see .env.example).',
  )
}

const isLocal =
  !!connectionString &&
  (connectionString.includes('localhost') || connectionString.includes('127.0.0.1'))

// TODO(security): DEFAULT_REJECT_UNAUTHORIZED should be true (verify the
// Supabase pooler's cert chain) — tested against this project's real
// DATABASE_URL on 2026-07-17 and Node's default verification failed with
// "self-signed certificate in certificate chain" (confirmed not a local
// network/proxy issue: a plain HTTPS request to google.com verifies fine
// in the same environment). Revisit once Supabase's pooler cert is
// confirmed valid for this project's region, then flip the default below.
// PGSSLMODE=no-verify stays available as an explicit, auditable escape
// hatch for any environment where it's still true.
const DEFAULT_REJECT_UNAUTHORIZED = false
const rejectUnauthorized = process.env.PGSSLMODE === 'no-verify' ? false : DEFAULT_REJECT_UNAUTHORIZED

export const pool = new Pool({
  connectionString,
  ssl: connectionString && !isLocal ? { rejectUnauthorized } : undefined,
})

// --- Tenancy enforcement (PLAN.md §5.4) -------------------------------------
// This is the whole tenancy security model: every tenant-owned query must run
// through orgQuery (or studentQuery), which forces org_id (or portal_token)
// scoping. Raw pool.query is for db.ts/migrate.ts only.

export async function orgQuery<T extends QueryResultRow = QueryResultRow>(
  orgId: string,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  if (!/org_id/i.test(sql)) {
    throw new Error('orgQuery: SQL must reference org_id — refusing to run an unscoped tenant query')
  }
  const { rows } = await pool.query<T>(sql, [orgId, ...params])
  return rows
}

export async function studentQuery<T extends QueryResultRow = QueryResultRow>(
  portalToken: string,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  if (!/portal_token/i.test(sql)) {
    throw new Error('studentQuery: SQL must reference portal_token — refusing to run an unscoped student query')
  }
  const { rows } = await pool.query<T>(sql, [portalToken, ...params])
  return rows
}

// Attempt-token surfaces (the runner + review) are keyed by their own magic
// link, distinct from a student's portal_token — same "the token is the
// whole access control" model, so it gets the same guarded-query treatment.
export async function attemptQuery<T extends QueryResultRow = QueryResultRow>(
  attemptToken: string,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  if (!/attempt_token/i.test(sql)) {
    throw new Error('attemptQuery: SQL must reference attempt_token — refusing to run an unscoped attempt query')
  }
  const { rows } = await pool.query<T>(sql, [attemptToken, ...params])
  return rows
}

// Uploaded files (worksheets, plan pages, photos of work) are served by their
// own unguessable token, the same model as the portal and attempt links.
export async function fileQuery<T extends QueryResultRow = QueryResultRow>(
  fileToken: string,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  if (!/file_token/i.test(sql)) {
    throw new Error('fileQuery: SQL must reference file_token — refusing to run an unscoped file query')
  }
  const { rows } = await pool.query<T>(sql, [fileToken, ...params])
  return rows
}

// Live boards are keyed by their id, the guest access model for teaching
// surfaces (routes/board.ts). Writes made from inside a board (answers to its
// questions) scope through it: the SQL marks its board key with board_id.
export async function boardQuery<T extends QueryResultRow = QueryResultRow>(
  boardId: string,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  if (!/board_id/i.test(sql)) {
    throw new Error('boardQuery: SQL must reference board_id — refusing to run an unscoped board query')
  }
  const { rows } = await pool.query<T>(sql, [boardId, ...params])
  return rows
}
