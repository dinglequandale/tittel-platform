import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Router } from './router.tsx'
import './styles.css'
import * as Sentry from '@sentry/react'
import { BRAND_NAME } from '@tittel/shared'

// index.html carries a static title for the first paint; this keeps a rename to one line (brand.ts).
document.title = BRAND_NAME

// Error reports (OVERHAUL §5, Ops): on only when VITE_SENTRY_DSN is set at build.
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({ dsn: import.meta.env.VITE_SENTRY_DSN, environment: import.meta.env.MODE, sendDefaultPii: false })
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Router />
    </BrowserRouter>
  </React.StrictMode>,
)
