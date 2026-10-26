import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { CalendarDays, Users, BookOpen, BarChart3, Settings, Search, Plus } from 'lucide-react'
import { Shell, Wordmark, Qed, Menu, MenuTrigger, MenuContent, MenuItem } from '@tittel/ui'
import { BRAND_NAME } from '@tittel/shared'
import { supabase } from '../lib/supabase.ts'
import { useSession } from '../lib/useSession.ts'
import { AppToastProvider } from '../lib/toast.tsx'
import { ScheduleLessonDialog } from '../lessons/ScheduleLessonDialog.tsx'

// Five places, organised around the tutor's week rather than the database
// (FLOW-SPEC §2.6): lessons are the hub; Library and Insights are where you
// browse and look back.
const NAV = [
  { to: '/app', label: 'This week', icon: CalendarDays, end: true },
  { to: '/app/students', label: 'Students', icon: Users },
  { to: '/app/library', label: 'Library', icon: BookOpen },
  { to: '/app/insights', label: 'Insights', icon: BarChart3 },
  { to: '/app/settings', label: 'Settings', icon: Settings },
]

export function AppShell() {
  const { session } = useSession()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [scheduling, setScheduling] = useState(false)

  // Most-specific match wins the topbar title (reverse so nested paths beat '/app').
  const current = [...NAV]
    .reverse()
    .find((n) => (n.end ? pathname === n.to : pathname === n.to || pathname.startsWith(n.to + '/')))
  const title = pathname.startsWith('/app/lessons/') ? 'Lesson' : current?.label ?? 'This week'

  const email = session?.user.email ?? ''
  const local = email.split('@')[0]
  const displayName = local ? local.charAt(0).toUpperCase() + local.slice(1) : BRAND_NAME
  const initial = displayName[0].toUpperCase()

  return (
    <AppToastProvider>
      <Shell
        sidebar={
          <>
            <div className="shell-brand">
              <Wordmark name={BRAND_NAME} />
            </div>
            <nav className="shell-nav">
              {NAV.map(({ to, label, icon: Icon, end }) => (
                <NavLink key={to} to={to} end={end} className="shell-nav-item" title={label}>
                  <Icon size={18} strokeWidth={1.75} />
                  <span className="shell-nav-label">{label}</span>
                </NavLink>
              ))}
            </nav>
            <div className="shell-sidebar-spacer" />
            <div className="shell-sidebar-footer">
              <div className="shell-org">
                <div className="shell-org-avatar">{initial}</div>
                <div className="shell-org-meta">
                  <span className="shell-org-name">{displayName}</span>
                  <button className="shell-org-sub" onClick={() => supabase.auth.signOut()}>
                    Sign out
                  </button>
                </div>
              </div>
            </div>
          </>
        }
        topbar={
          <>
            <span className="shell-topbar-title">{title}<Qed /></span>
            <div className="shell-topbar-actions">
              <div className="shell-search">
                <Search size={15} strokeWidth={1.9} />
                <span>Search students, lessons…</span>
              </div>
              <Menu>
                <MenuTrigger asChild>
                  <button className="shell-new-btn">
                    <Plus size={15} strokeWidth={2.1} />
                    <span>New</span>
                  </button>
                </MenuTrigger>
                <MenuContent>
                  <MenuItem onSelect={() => setScheduling(true)}>Lesson</MenuItem>
                  <MenuItem onSelect={() => navigate('/app/students?new=1')}>Student</MenuItem>
                  <MenuItem onSelect={() => navigate('/app/insights?tab=homework')}>Homework</MenuItem>
                  <MenuItem onSelect={() => window.open('/try', '_blank', 'noopener')}>Quick board</MenuItem>
                </MenuContent>
              </Menu>
            </div>
          </>
        }
      >
        <Outlet />
      </Shell>
      <ScheduleLessonDialog open={scheduling} onOpenChange={setScheduling} />
    </AppToastProvider>
  )
}
