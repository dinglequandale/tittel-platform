import { Link } from 'react-router-dom'
import { Button } from '@tittel/ui'
import { BRAND_NAME, BRAND_TAGLINE } from '@tittel/shared'

// Real landing page (hero demo board, pricing, the 650->760 story) is a
// Phase 7 build (PLAN.md §12) — this stub proves the route + design tokens.
export function Landing() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 px-4 text-center">
      <h1 className="font-display text-3xl">{BRAND_NAME}</h1>
      <p className="text-lg text-ink-2">{BRAND_TAGLINE}</p>
      <div className="flex gap-3">
        <Link to="/signup">
          <Button>Start a trial</Button>
        </Link>
        <Link to="/login">
          <Button variant="secondary">Sign in</Button>
        </Link>
      </div>
    </main>
  )
}
