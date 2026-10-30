import { useState } from 'react'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, Field, Input } from '@tittel/ui'
import { apiFetch } from '../lib/api.ts'
import { useOrg } from '../lib/useOrg.ts'
import { useSession } from '../lib/useSession.ts'
import { ParentUpdateDialog, recipientsOf, portalLink, firstName, tutorSignature } from '../lessons/ParentUpdate.tsx'
import { fillTemplate, DEFAULT_TEMPLATES } from '../lessons/template.ts'
import { shortDate } from '../lessons/lessons.ts'

export type Period = 'last4' | 'this_month' | 'last_month' | 'custom'

interface Progress {
  student: { id: string; name: string; portal_token: string; emails: { email: string; role: 'student' | 'parent' }[] }
  lessons: { scheduled_at: string; notes: string | null; plan_title: string | null; group_name: string | null }[]
  homework: { title: string; due_at: string | null; status: string | null; submitted_at: string | null; score: number; total: number }[]
  board: { right: number; total: number }
}

const DAY_MS = 86_400_000
const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const dateInput = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const monthDay = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

/** [from, to) for a period, in the tutor's own time zone. */
export function periodRange(p: Period, custom?: { from: string; to: string }): { from: Date; to: Date } {
  const today = day(new Date())
  if (p === 'this_month') return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: new Date(today.getTime() + DAY_MS) }
  if (p === 'last_month') return { from: new Date(today.getFullYear(), today.getMonth() - 1, 1), to: new Date(today.getFullYear(), today.getMonth(), 1) }
  if (p === 'custom' && custom?.from && custom.to) {
    return { from: new Date(`${custom.from}T00:00`), to: new Date(new Date(`${custom.to}T00:00`).getTime() + DAY_MS) }
  }
  return { from: new Date(today.getTime() - 27 * DAY_MS), to: new Date(today.getTime() + DAY_MS) }
}

function homeworkLine(h: Progress['homework'][number]): string {
  const done = h.status === 'submitted' || h.status === 'expired'
  if (done) return `- ${h.title}: ${h.total ? `${h.score}/${h.total}` : 'handed in'}`
  if (h.due_at && new Date(h.due_at).getTime() < Date.now()) return `- ${h.title}: not done (was due ${shortDate(h.due_at)})`
  return `- ${h.title}: ${h.due_at ? `due ${shortDate(h.due_at)}` : 'not done yet'}`
}

/** The template's facts for one student and period. */
export function reportVars(p: Progress, range: { from: Date; to: Date }, tutorName: string): Record<string, string> {
  const done = p.homework.filter((h) => h.status === 'submitted' || h.status === 'expired')
  const graded = done.filter((h) => h.total > 0)
  const right = graded.reduce((n, h) => n + h.score, 0)
  const total = graded.reduce((n, h) => n + h.total, 0)
  const summary = p.homework.length === 0 ? ''
    : `${done.length} of ${p.homework.length} handed in${total ? `, ${Math.round((right / total) * 100)}% right` : ''}`
  return {
    first_name: firstName(p.student.name),
    period: `${monthDay(range.from)} to ${monthDay(new Date(range.to.getTime() - DAY_MS))}`,
    lesson_count: p.lessons.length ? String(p.lessons.length) : '',
    lessons: p.lessons.map((l) => {
      const what = (l.notes?.trim() || l.plan_title || '').replace(/\s*\n\s*/g, ' ')
      return `- ${shortDate(l.scheduled_at)}${l.group_name ? ` (${l.group_name})` : ''}${what ? `: ${what}` : ''}`
    }).join('\n'),
    homework_summary: summary,
    homework_list: p.homework.map(homeworkLine).join('\n'),
    board_summary: p.board.total ? `${p.board.right} of ${p.board.total} answers right` : '',
    portal_link: portalLink(p.student.portal_token),
    tutor_name: tutorName,
  }
}

/**
 * A progress report for one student's parents over a period the tutor picks,
 * in the tutor's own wording (Settings → Parents). Sent the same way as a
 * lesson update: copied, or opened in the tutor's email. Never sent by the app.
 */
export function ProgressReportDialog({
  studentId, defaultPeriod = 'last4', onClose, onSent,
}: { studentId: string; defaultPeriod?: Period; onClose: () => void; onSent?: () => void }) {
  const org = useOrg()
  const { session } = useSession()
  const [period, setPeriod] = useState<Period>(defaultPeriod)
  const [custom, setCustom] = useState(() => {
    const r = periodRange('last4')
    return { from: dateInput(r.from), to: dateInput(new Date(r.to.getTime() - DAY_MS)) }
  })
  const range = periodRange(period, custom)
  const key = `${range.from.toISOString()}|${range.to.toISOString()}|${org ? 'org' : ''}`

  async function fetchFacts() {
    const p: Progress = await apiFetch(`/api/tutor/students/${studentId}/progress?from=${encodeURIComponent(range.from.toISOString())}&to=${encodeURIComponent(range.to.toISOString())}`)
    return { p, vars: reportVars(p, range, tutorSignature(org, session?.user.email)) }
  }

  if (!org) return null
  const aiOn = org.aiAvailable && org.aiHelp

  return (
    <ParentUpdateDialog
      title="Progress report"
      draftKey={key}
      onClose={onClose}
      onSent={() => { apiFetch(`/api/tutor/students/${studentId}/report-sent`, { method: 'POST', body: '{}' }).then(() => onSent?.()).catch(() => {}) }}
      load={async () => {
        const { p, vars } = await fetchFacts()
        const { subject, body } = fillTemplate(org.parentTemplates.report ?? DEFAULT_TEMPLATES.report, vars)
        return { to: recipientsOf([p.student]), subject, body }
      }}
      draftWithAi={aiOn ? async () => {
        const { vars } = await fetchFacts()
        const { text } = await apiFetch('/api/tutor/ai/parent-update', {
          method: 'POST',
          body: JSON.stringify({ facts: [
            `Student: ${vars.first_name}`, `Period: ${vars.period}`,
            ...(vars.lessons ? [`Lessons:\n${vars.lessons}`] : ['No lessons in this period.']),
            ...(vars.homework_summary ? [`Homework: ${vars.homework_summary}.\n${vars.homework_list}`] : []),
            ...(vars.board_summary ? [`On the board: ${vars.board_summary}.`] : []),
          ].join('\n') }),
        })
        return ['Hi,', '', text, '', `${vars.first_name}'s homework and lessons are here: ${vars.portal_link}`, '', 'Best,', vars.tutor_name].join('\n')
      } : undefined}
    >
      <div className="form-row">
        <Field label="Period">
          <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="last4">Last 4 weeks</SelectItem>
              <SelectItem value="this_month">This month</SelectItem>
              <SelectItem value="last_month">Last month</SelectItem>
              <SelectItem value="custom">Dates…</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {period === 'custom' && (
          <>
            <Field label="From"><Input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /></Field>
            <Field label="To"><Input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></Field>
          </>
        )}
      </div>
    </ParentUpdateDialog>
  )
}
