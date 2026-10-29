import type { Request, Response, NextFunction } from 'express'

// Abuse limits for the public link surfaces (OVERHAUL §5, Security): requests
// per client IP in a fixed one-minute window, per route group. Generous on
// purpose: a whole class can sit behind one school IP, and the runner saves
// as students type. This stops floods and scripts, not normal use.
export function rateLimit(perMinute: number) {
  const hits = new Map<string, { count: number; resetAt: number }>()
  let sweepAt = Date.now() + 60_000
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now()
    if (now > sweepAt) {
      for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k)
      sweepAt = now + 60_000
    }
    const key = req.ip ?? 'unknown'
    let h = hits.get(key)
    if (!h || h.resetAt <= now) {
      h = { count: 0, resetAt: now + 60_000 }
      hits.set(key, h)
    }
    if (++h.count > perMinute) {
      res.setHeader('retry-after', String(Math.ceil((h.resetAt - now) / 1000)))
      return res.status(429).json({ error: 'Too many requests. Wait a minute and try again.' })
    }
    next()
  }
}
