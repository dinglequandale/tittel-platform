import type { ConnectionOptions } from 'node:tls'

// TLS for the Postgres pool (db.ts). A local database gets none.
//
// DATABASE_CA_CERT is the CA that signed the database's certificate (Supabase:
// Database settings -> SSL configuration), as PEM text in an env var. With it
// set, the server's certificate is verified against it. PGSSLMODE=no-verify
// still turns verification off: an explicit, auditable escape hatch.
//
// TODO(security): without a CA, DEFAULT_REJECT_UNAUTHORIZED stays false.
// Tested against this project's real DATABASE_URL on 2026-07-17, Node's
// default verification failed with "self-signed certificate in certificate
// chain" (not a local network/proxy issue: a plain HTTPS request to google.com
// verified fine in the same environment): the pooler's chain ends at Supabase's
// own CA, which Node doesn't trust. Flip the default once a connection with
// DATABASE_CA_CERT is confirmed on Render.
const DEFAULT_REJECT_UNAUTHORIZED = false

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
