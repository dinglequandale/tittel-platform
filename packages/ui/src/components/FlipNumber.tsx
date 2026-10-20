import { useEffect, useState } from 'react'

const GLYPHS = ['π', '∑', '√', '?', '%', '∞']
const COLORS = ['var(--blue)', 'var(--pink)', 'var(--coral)', 'var(--gold)', 'var(--mint)']
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]

function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// The website's step-number flip: the value flickers through math glyphs in
// palette colours, then lands with a pop. Plays when the value first appears
// or changes; screen readers only ever get the final value.
export function FlipNumber({ value, delay = 0 }: { value: string | number; delay?: number }) {
  const final = String(value)
  const [shown, setShown] = useState<{ text: string; color?: string; settled: boolean }>({ text: final, settled: true })

  useEffect(() => {
    if (reducedMotion()) {
      setShown({ text: final, settled: true })
      return
    }
    const timers = [0, 90, 180].map((d) =>
      window.setTimeout(() => setShown({ text: pick(GLYPHS), color: pick(COLORS), settled: false }), delay + d),
    )
    timers.push(window.setTimeout(() => setShown({ text: final, settled: true }), delay + 270))
    return () => timers.forEach(clearTimeout)
  }, [final, delay])

  return (
    <span className="flip-number" aria-label={final}>
      <span
        aria-hidden="true"
        key={shown.text + String(shown.settled)}
        className={shown.settled ? 'flip-number-settle' : 'flip-number-glyph'}
        style={shown.color ? { color: shown.color } : undefined}
      >
        {shown.text}
      </span>
    </span>
  )
}
