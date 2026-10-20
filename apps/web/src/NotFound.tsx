import { Link } from 'react-router-dom'
import { MathArt, Qed } from '@tittel/ui'

// 404: an impossible object for a page that doesn't exist.
export function NotFound() {
  return (
    <main className="not-found">
      <MathArt name="penrose" className="not-found-art" />
      <h1 className="not-found-title">this page doesn't exist<Qed /></h1>
      <p className="not-found-lede">The link may be old, or mistyped.</p>
      <Link to="/" className="btn btn-primary">Go home</Link>
    </main>
  )
}
