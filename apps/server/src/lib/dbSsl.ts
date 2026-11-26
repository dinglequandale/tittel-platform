import type { ConnectionOptions } from 'node:tls'

// TLS for the Postgres pool (db.ts). A local database gets none.
//
// DATABASE_CA_CERT is the CA that signed the database's certificate (Supabase:
// Database settings -> SSL configuration), as PEM text in an env var. With it
// set, the server's certificate is verified against it. PGSSLMODE=no-verify
// still turns verification off: an explicit, auditable escape hatch.
//
// Verified by default. Supabase's pooler chain ends at Supabase's own CA, which
// Node doesn't trust, so a Supabase DATABASE_URL needs DATABASE_CA_CERT set
// (confirmed on Render 2026-11-26); without it the connection is refused
// rather than silently left unverified.
const DEFAULT_REJECT_UNAUTHORIZED = true

export function dbSsl(
  connectionString: string | undefined,
  env: { DATABASE_CA_CERT?: string; PGSSLMODE?: string },
): ConnectionOptions | undefined {
  if (!connectionString) return undefined
  if (connectionString.includes('localhost') || connectionString.includes('127.0.0.1')) return undefined
  // Pasted into a single-line env field, a PEM's newlines arrive as "\n".
  const ca = env.DATABASE_CA_CERT?.trim().replace(/\\n/g, '\n') || undefined
  if (env.PGSSLMODE === 'no-verify') return { rejectUnauthorized: false }
  if (ca) return { rejectUnauthorized: true, ca }
  return { rejectUnauthorized: DEFAULT_REJECT_UNAUTHORIZED }
}
