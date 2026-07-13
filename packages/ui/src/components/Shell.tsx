import type { ReactNode } from 'react'

export function Shell({ sidebar, topbar, children }: { sidebar: ReactNode; topbar?: ReactNode; children: ReactNode }) {
  return (
    <div className="shell">
      <aside className="shell-sidebar">{sidebar}</aside>
      <div>
        {topbar && <header className="shell-topbar">{topbar}</header>}
        <main className="shell-main">{children}</main>
      </div>
    </div>
  )
}

export function ShellNavItem({
  href,
  icon,
  label,
  current,
}: {
  href: string
  icon?: ReactNode
  label: string
  current?: boolean
}) {
  return (
    <a href={href} className="shell-nav-item" aria-current={current ? 'page' : undefined}>
      {icon}
      {label}
    </a>
  )
}
