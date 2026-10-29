import { Link } from 'react-router-dom'
import { MathArt, Qed, Wordmark } from '@tittel/ui'
import { BRAND_NAME, BRAND_TAGLINE } from '@tittel/shared'

// Placeholder landing in the new visual language. The lean landing (hero
// scramble ported from the website) is O5 and the showpiece is O7
// (OVERHAUL.md §3); headline copy here is provisional.
export function Landing() {
  return (
    <div className="landing">
      <Link to="/" className="corner corner-tl" aria-label={`${BRAND_NAME} home`}><Wordmark name={BRAND_NAME} /></Link>
      <Link to="/login" className="corner corner-tr">sign in</Link>
      <main className="landing-hero">
        <div className="landing-stage" aria-hidden="true">
          <MathArt name="pythagoras" className="landing-card landing-card-1" />
          <MathArt name="orange" className="landing-card landing-card-2" />
          <MathArt name="euler" className="landing-card landing-card-3" />
          <MathArt name="sheet" className="landing-card landing-card-4" />
        </div>
        <h1 className="landing-headline">teach the <span className="serif-em">why</span><Qed /></h1>
        <p className="landing-lede">{BRAND_TAGLINE}</p>
        <div className="landing-cta">
          <Link to="/signup" className="btn btn-primary">Start a trial</Link>
          <Link to="/try" className="btn btn-secondary">Try a free board</Link>
        </div>
      </main>
      <footer className="landing-footer">
        <Link to="/privacy">Privacy</Link> · <Link to="/terms">Terms</Link>
      </footer>
    </div>
  )
}
