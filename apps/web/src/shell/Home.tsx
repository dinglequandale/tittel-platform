import { Sparkles } from 'lucide-react'
import { EmptyState } from '@tittel/ui'

// Today-centric dashboard (PLAN.md §6.1) — real content (upcoming
// assignments, recent sessions, students needing attention) lands in Phase 5.
export function Home() {
  return (
    <EmptyState
      icon={<Sparkles size={32} strokeWidth={1.5} />}
      title="Welcome to Slate"
      description="Your home dashboard will show upcoming assignments, recent sessions, and students needing attention once you add your first student."
    />
  )
}
