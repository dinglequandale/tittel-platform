// Lazily loads the Desmos GraphingCalculator API — the <script> is only fetched
// the first time the tutor opens the calculator, never on initial page load.
//
// Desmos's public demo key is for development only; production use needs our
// own key (OVERHAUL.md §5, licensing). In a production build without
// VITE_DESMOS_API_KEY the calculator reports itself unavailable rather than
// quietly running on the demo key.
const API_KEY =
  import.meta.env.VITE_DESMOS_API_KEY || (import.meta.env.DEV ? 'dcb31709b452b1cf9dc26972add0fda6' : '')
const SRC = `https://www.desmos.com/api/v1.11/calculator.js?apiKey=${API_KEY}`

// Minimal shape of what we use from the Desmos global — full API is untyped.
type DesmosApi = {
  GraphingCalculator: (el: HTMLElement, opts?: Record<string, unknown>) => any
}

let loadPromise: Promise<DesmosApi> | null = null

export function loadDesmos(): Promise<DesmosApi> {
  const existing = (window as any).Desmos as DesmosApi | undefined
  if (existing) return Promise.resolve(existing)
  if (loadPromise) return loadPromise
  if (!API_KEY) return Promise.reject(new Error('The calculator is not configured yet (VITE_DESMOS_API_KEY).'))

  loadPromise = new Promise<DesmosApi>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SRC
    script.async = true
    script.onload = () => {
      const api = (window as any).Desmos as DesmosApi | undefined
      if (api) resolve(api)
      else reject(new Error('Desmos loaded but global was not found'))
    }
    script.onerror = () => {
      loadPromise = null // allow a retry on next activation
      reject(new Error('Failed to load the Desmos calculator'))
    }
    document.head.appendChild(script)
  })
  return loadPromise
}
