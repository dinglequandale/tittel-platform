import { Link } from 'react-router-dom'
import { Sparkles, Users, ClipboardList, PenTool } from 'lucide-react'
import { EmptyState } from '@tittel/ui'

const QUICK_ACTIONS = [
  { to: '/app/students', icon: Users, title: 'New student' },
  { to: '/app/assignments', icon: ClipboardList, title: 'New assignment' },
  { to: '/app/live', icon: PenTool, title: 'Start a board' },
]

// Today-centric dashboard (PLAN.md §6.1) — real content (upcoming
// assignments, recent sessions, students needing attention) lands in Phase 5.
export function Home() {
  return (
    <EmptyState
      icon={<Sparkles size={32} strokeWidth={1.5} />}
      title="Welcome to Slate"
      description="Your home dashboard will show upcoming assignments, recent sessions, and students needing attention once you add your first student."
      action={
        <div className="quick-action-row">
          {QUICK_ACTIONS.map(({ to, icon: Icon, title }) => (
            <Link key={to} to={to} className="quick-action">
              <Icon size={20} strokeWidth={1.75} className="quick-action-icon" />
              <span className="quick-action-title">{title}</span>
            </Link>
          ))}
        </div>
      }
    />
  )
}
