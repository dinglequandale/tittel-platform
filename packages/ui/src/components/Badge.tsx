import type { ReactNode } from 'react'
import clsx from 'clsx'

export type BadgeTone = 'neutral' | 'accent' | 'correct' | 'incorrect' | 'warning'

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span className={clsx('badge', tone !== 'neutral' && `badge-${tone}`)}>{children}</span>
  )
}
