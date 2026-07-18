import { NavLink, Outlet } from 'react-router-dom'
import { Home, Users, BookOpen, PenTool, ClipboardList, BarChart3, Settings } from 'lucide-react'
import { Button, Shell } from '@tittel/ui'
import { BRAND_NAME } from '@tittel/shared'
import { supabase } from '../lib/supabase.ts'
import { useSession } from '../lib/useSession.ts'
import { AppToastProvider } from '../lib/toast.tsx'

const NAV = [
  { to: '/app', label: 'Home', icon: Home, end: true },
  { to: '/app/students', label: 'Students', icon: Users },
  { to: '/app/content', label: 'Content', icon: BookOpen },
  { to: '/app/live', label: 'Live', icon: PenTool },
  { to: '/app/assignments', label: 'Assignments', icon: ClipboardList },
  { to: '/app/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/app/settings', label: 'Settings', icon: Settings },
]

export function AppShell() {
  const { session } = useSession()

  return (
    <AppToastProvider>
      <Shell
        sidebar={
          <>
            <div className="shell-sidebar-brand">{BRAND_NAME}</div>
            <nav className="flex flex-col gap-1">
              {NAV.map(({ to, label, icon: Icon, end }) => (
                <NavLink key={to} to={to} end={end} className="shell-nav-item" title={label}>
                  <Icon size={16} strokeWidth={1.75} />
                  <span className="shell-nav-label">{label}</span>
                </NavLink>
              ))}
            </nav>
          </>
        }
        topbar={
          <>
            <span className="text-sm text-ink-2">{session?.user.email}</span>
            <Button variant="ghost" onClick={() => supabase.auth.signOut()}>
              Sign out
            </Button>
          </>
        }
      >
        <Outlet />
      </Shell>
    </AppToastProvider>
  )
}
