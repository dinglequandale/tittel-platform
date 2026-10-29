import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { apiFetch } from '../lib/api.ts'
import { type Lesson, lessonWho, shortDate, timeLabel } from '../lessons/lessons.ts'

interface Hit { key: string; label: string; sub: string; to: string }

// Find a student, group or lesson from anywhere (Ctrl/⌘ K). The roster and
// the lessons around now load on first focus and are searched in place.
export function GlobalSearch() {
  const navigate = useNavigate()
  const input = useRef<HTMLInputElement>(null)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [data, setData] = useState<Hit[] | null>(null)
  const loading = useRef(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.current?.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function load() {
    if (data || loading.current) return
    loading.current = true
    const from = new Date(Date.now() - 14 * 86400e3).toISOString()
    const to = new Date(Date.now() + 30 * 86400e3).toISOString()
    const [s, g, l] = await Promise.all([
      apiFetch('/api/tutor/students').catch(() => ({ students: [] })),
      apiFetch('/api/tutor/groups').catch(() => ({ groups: [] })),
      apiFetch(`/api/tutor/sessions?from=${from}&to=${to}`).catch(() => ({ lessons: [] })),
    ])
    setData([
      ...s.students.map((x: { id: string; name: string; emails: { email: string }[] }) => ({
        key: `s${x.id}`, label: x.name, sub: ['Student', ...x.emails.map((e) => e.email)].join(' · '), to: `/app/students/${x.id}`,
      })),
      ...g.groups.map((x: { id: string; name: string; members: { name: string }[] }) => ({
        key: `g${x.id}`, label: x.name, sub: `Group · ${x.members.map((m) => m.name).join(', ')}`, to: '/app/students',
      })),
      ...l.lessons.map((x: Lesson) => ({
        key: `l${x.id}`, label: lessonWho(x), sub: `Lesson · ${shortDate(x.scheduled_at)}, ${timeLabel(x.scheduled_at)}`, to: `/app/lessons/${x.id}`,
      })),
    ])
  }

  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const hits = terms.length && data
    ? data.filter((h) => terms.every((t) => `${h.label} ${h.sub}`.toLowerCase().includes(t))).slice(0, 8)
    : []

  function go(h: Hit) {
    navigate(h.to)
    setQ(''); setOpen(false); input.current?.blur()
  }

  return (
    <div className="shell-search" onClick={() => input.current?.focus()}>
      <Search size={15} strokeWidth={1.9} />
      <input ref={input} value={q} placeholder="Search students, lessons…" aria-label="Search students, groups and lessons"
        role="combobox" aria-expanded={open && hits.length > 0} aria-controls="search-results"
        onFocus={() => { setOpen(true); void load() }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { setQ(e.target.value); setActive(0); setOpen(true); void load() }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
          else if (e.key === 'Enter' && hits[active]) go(hits[active])
          else if (e.key === 'Escape') { setQ(''); input.current?.blur() }
        }} />
      <kbd className="shell-search-kbd">Ctrl K</kbd>
      {open && terms.length > 0 && (
        <div className="search-results" id="search-results" role="listbox">
          {data === null ? <div className="search-empty">Loading…</div>
            : hits.length === 0 ? <div className="search-empty">Nothing matches “{q}”</div>
              : hits.map((h, i) => (
                <button key={h.key} role="option" aria-selected={i === active} className="search-hit" data-active={i === active}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => go(h)}>
                  <span className="search-hit-label">{h.label}</span>
                  <span className="search-hit-sub">{h.sub}</span>
                </button>
              ))}
        </div>
      )}
    </div>
  )
}
