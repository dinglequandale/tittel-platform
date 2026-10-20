import type { ReactNode } from 'react'
import { MathArt } from './MathArt.tsx'
import type { MathArtName } from '../mathArt.ts'

export interface EmptyStateProps {
  icon?: ReactNode
  /** A math graphic from the website's set; preferred over `icon`. */
  art?: MathArtName
  title: string
  description?: string
  action?: ReactNode
}

export function EmptyState({ icon, art, title, description, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      {art ? <MathArt name={art} className="empty-state-art" /> : icon && <div className="empty-state-icon">{icon}</div>}
      <div className="empty-state-title">{title}</div>
      {description && <p>{description}</p>}
      {action}
    </div>
  )
}
