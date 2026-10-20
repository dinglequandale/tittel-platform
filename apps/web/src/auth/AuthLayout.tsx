import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { MathArt, Wordmark } from '@tittel/ui'
import { BRAND_NAME } from '@tittel/shared'

// Split auth layout: the form on white, a collage of the website's math
// cards on the other half (hidden on narrow screens).
export function AuthLayout({ title, lede, children, footer }: { title: string; lede?: string; children?: ReactNode; footer?: ReactNode }) {
  return (
    <div className="auth">
      <main className="auth-main">
        <Link to="/" className="auth-brand" aria-label={`${BRAND_NAME} home`}>
          <Wordmark name={BRAND_NAME} />
        </Link>
        <div className="auth-body">
          <h1 className="auth-title">{title}</h1>
          {lede && <p className="auth-lede">{lede}</p>}
          {children}
          {footer && <p className="auth-footer">{footer}</p>}
        </div>
      </main>
      <aside className="auth-art" aria-hidden="true">
        <MathArt name="pythagoras" className="auth-card auth-card-1" />
        <MathArt name="euler" className="auth-card auth-card-2" />
        <MathArt name="penrose" className="auth-card auth-card-3" />
      </aside>
    </div>
  )
}
