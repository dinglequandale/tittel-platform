import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Scroll to the #section in the address once the page has rendered it.
 * The browser only does this on a full load, not after a page's data
 * arrives in an app like this one.
 */
export function useHashScroll(ready: boolean): void {
  const { hash } = useLocation()
  useEffect(() => {
    if (!ready || !hash) return
    const t = window.setTimeout(() => document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
    return () => window.clearTimeout(t)
  }, [ready, hash])
}
