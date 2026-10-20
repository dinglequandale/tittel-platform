import { useId, useMemo } from 'react'
import clsx from 'clsx'
import { MATH_ART, type MathArtName } from '../mathArt.ts'

export interface MathArtProps {
  name: MathArtName
  className?: string
}

// Decorative math graphic (from the tutoring website). Always aria-hidden:
// it's ornament, never content.
export function MathArt({ name, className }: MathArtProps) {
  // useId() yields ":r1:"-style ids; colons break url(#...) references.
  const prefix = 'ma' + useId().replace(/[^a-zA-Z0-9]/g, '')
  const html = useMemo(() => MATH_ART[name].replace(/__-/g, `${prefix}-`), [name, prefix])
  return <span className={clsx('math-art', className)} aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />
}
