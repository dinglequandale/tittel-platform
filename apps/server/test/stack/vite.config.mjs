// The web app on :5374 against the test stack (stack.mjs on :6070/:5498), for
// signed-in screens in a browser. Its own dependency cache: two Vites sharing
// apps/web/node_modules/.vite break each other's React ("Invalid hook call").
// Sign in: fetch http://localhost:5498/test-session?u=<slug> and store the JSON
// in localStorage as `sb-localhost-auth-token`.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../../..')
const SERVER = 'http://localhost:6070'

export default {
  root: path.join(repo, 'apps/web'),
  // No .env from apps/web: it names the real Supabase project.
  envDir: here,
  cacheDir: path.join(here, '.data/vite-cache'),
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('http://localhost:5498'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('test-anon-key'),
  },
  plugins: [react()],
  server: {
    port: 5374,
    strictPort: true,
    proxy: {
      '/api': { target: SERVER },
      '/uploads': { target: SERVER },
      '/connect': { target: SERVER, ws: true },
      '/control': { target: SERVER, ws: true },
    },
    fs: { allow: [repo] },
  },
}
