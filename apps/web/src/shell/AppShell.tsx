import { NavLink, Outlet, Link, useLocation } from 'react-router-dom'
import { Home, Users, BookOpen, PenTool, ClipboardList, BarChart3, Settings, Search, Plus } from 'lucide-react'
import { Shell } from '@tittel/ui'
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
  const { pathname } = useLocation()

  // Most-specific match wins the topbar title (reverse so nested paths beat '/app').
  const current = [...NAV]
    .reverse()
    .find((n) => (n.end ? pathname === n.to : pathname === n.to || pathname.startsWith(n.to + '/')))
  const title = current?.label ?? 'Home'

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
              <div className="shell-brand-mark" />
              <span className="shell-brand-name">{BRAND_NAME}</span>
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
            <span className="shell-topbar-title">{title}</span>
            <div className="shell-topbar-actions">
              <div className="shell-search">
                <Search size={15} strokeWidth={1.9} />
                <span>Search students, lessons…</span>
              </div>
              <Link to="/app/content" className="shell-new-btn">
                <Plus size={15} strokeWidth={2.1} />
                <span>New</span>
              </Link>
            </div>
          </>
        }
      >
        <Outlet />
      </Shell>
    </AppToastProvider>
  )
}
