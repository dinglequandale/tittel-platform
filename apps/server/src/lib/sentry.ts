import '../env.ts'
import * as Sentry from '@sentry/node'

// Error reports (OVERHAUL §5, Ops): on only when SENTRY_DSN is set. Errors
// only, no performance tracing, and no request bodies (they can hold student
// work), so reports carry the error and where it happened.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: 0,
    sendDefaultPii: false,
  })
}
