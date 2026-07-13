import { Construction } from 'lucide-react'
import { EmptyState } from '@tittel/ui'

// Placeholder for modules built in later phases (PLAN.md §10) — keeps the full
// §4.3 route map navigable from Phase 0 onward.
export function ModulePlaceholder({ title }: { title: string }) {
  return (
    <EmptyState
      icon={<Construction size={32} strokeWidth={1.5} />}
      title={title}
      description="This module hasn't been built yet."
    />
  )
}
