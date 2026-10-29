/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  /** 'on' once Google is enabled as a Supabase auth provider. */
  readonly VITE_GOOGLE_AUTH?: string
  /** Error reporting (Sentry); unset = off. */
  readonly VITE_SENTRY_DSN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
