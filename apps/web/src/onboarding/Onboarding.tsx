import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Check } from 'lucide-react'
import { Button, Field, FlipNumber, Input, PageLoading, Qed, Wordmark } from '@tittel/ui'
import { BRAND_NAME } from '@tittel/shared'
import { apiFetch } from '../lib/api.ts'
import { supabase } from '../lib/supabase.ts'
import { AppToastProvider } from '../lib/toast.tsx'
import { saveOrg, useOrg, type Org } from '../lib/useOrg.ts'
import { DUE, SCHEDULE, Seg, WHERE } from '../settings/TeachingPrefs.tsx'
import { CalendarConnect, Choice, PROVIDER_NAME } from '../settings/CalendarConnect.tsx'
import { TemplateEditor, TemplatePreview } from '../settings/TemplateEditor.tsx'
import { DEFAULT_TEMPLATES } from '../lessons/template.ts'
import type { CalendarStatus } from '../lessons/CalendarInbox.tsx'
import { furthest, resumeStep, stepAfter, stepsFor, stepToShow, type StepId } from './steps.ts'

type Parents = 'lesson' | 'monthly' | 'both' | 'self'

const PARENT_CHOICES: { id: Parents; title: string; sub: string; prefs: Org['parentUpdates'] }[] = [
  { id: 'lesson', title: 'A note after each lesson', sub: 'What you covered, how it went and the homework.', prefs: { afterLesson: true, reports: true, reminder: 'none' } },
  { id: 'monthly', title: 'A monthly progress report', sub: "Each student's lessons, homework and scores for the month.", prefs: { afterLesson: false, reports: true, reminder: 'monthly' } },
  { id: 'both', title: 'Both', sub: 'A note after each lesson, and a report each month.', prefs: { afterLesson: true, reports: true, reminder: 'monthly' } },
  { id: 'self', title: 'I handle that myself', sub: 'Slate won’t offer parent messages. You can turn them on in Settings.', prefs: { afterLesson: false, reports: false, reminder: 'none' } },
]

function parentsChoice(p: Org['parentUpdates']): Parents {
  if (!p.afterLesson && !p.reports) return 'self'
  if (p.reports && p.reminder !== 'none') return p.afterLesson ? 'both' : 'monthly'
  return 'lesson'
}

const LABEL: Partial<Record<StepId, string>> = {
  you: 'About you', consent: 'Student privacy', teaching: 'How you teach', calendar: 'Your calendar', parents: 'Parents', report: 'Progress report',
}
const COLORS = ['blue', 'mint', 'gold', 'coral', 'blue', 'mint'] as const

export function Onboarding() {
  return <AppToastProvider><Sequence /></AppToastProvider>
}

// Setup, once per workspace, before anything else in the app (OVERHAUL §1:
// onboarding is where delight belongs). Every answer is saved as the tutor
// moves on, so a reload or another device picks up on the same step. Each
// step sets the side rail's next line, and the rail ends on the ∎.
function Sequence() {
  const org = useOrg()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [calendar, setCalendar] = useState<CalendarStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Finishing updates `org` before we've left for wherever the tutor picked.
  const leaving = useRef(false)

  useEffect(() => { apiFetch('/api/tutor/calendar').then(setCalendar).catch(() => setCalendar({ connected: false })) }, [])

  if (!org) return <PageLoading />
  if (org.onboardedAt && !leaving.current) return <Navigate to="/app" replace />

  const resume = resumeStep(org)
  const step = stepToShow(params.get('step'), resume, org.parentUpdates)
  const steps = stepsFor(org.parentUpdates)
  const asked = steps.filter((s) => s !== 'ready')
  const at = steps.indexOf(step)

  const go = (s: StepId, replace = false) => { setError(''); setParams({ step: s }, { replace }) }

  /** Saves this step's answers and moves on. */
  async function next(patch: Record<string, unknown> = {}) {
    setBusy(true)
    setError('')
    try {
      const parentUpdates = (patch.parentUpdates as Org['parentUpdates'] | undefined) ?? org!.parentUpdates
      const after = stepAfter(step, parentUpdates)
      await saveOrg({ ...patch, onboardingStep: furthest(resume, after) })
      go(after)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function finish(then: () => Promise<string> | string) {
    setBusy(true)
    setError('')
    leaving.current = true
    try {
      await saveOrg({ onboarded: true })
      navigate(await then(), { replace: true })
    } catch (err) {
      leaving.current = false
      setError((err as Error).message)
      setBusy(false)
    }
  }

  const back = at > 0 ? () => go(steps[at - 1]) : undefined
  const nav = { back, busy, error }

  const summary: Partial<Record<StepId, string>> = {
    you: org.displayName,
    consent: org.consentAt ? 'Confirmed' : '',
    teaching: [WHERE.find((w) => w[0] === org.teachWhere)?.[1], SCHEDULE.find((s) => s[0] === org.schedule)?.[1]].join(', '),
    calendar: calendar?.connected ? (calendar.provider ? PROVIDER_NAME[calendar.provider] : 'Connected') : 'Not connected',
    parents: PARENT_CHOICES.find((c) => c.id === parentsChoice(org.parentUpdates))?.title,
    report: org.parentTemplates.report === null ? 'Standard wording' : 'Your own wording',
  }

  return (
    <div className="ob">
      <aside className="ob-rail">
        <Wordmark name={BRAND_NAME} />
        <ol className="ob-steps">
          {asked.map((s, i) => {
            const done = steps.indexOf(s) < at
            const reached = steps.indexOf(s) <= steps.indexOf(resume)
            return (
              <li key={s} className="ob-rail-step" data-state={step === s ? 'now' : done ? 'done' : 'todo'}>
                <button type="button" disabled={!reached || step === s} onClick={() => go(s)} aria-current={step === s ? 'step' : undefined}>
                  <span className="step-num" data-c={step === s ? COLORS[i] : undefined} data-done={done}>
                    {done ? <Check size={14} strokeWidth={3} aria-label={`Step ${i + 1}, done`} /> : step === s ? <FlipNumber value={i + 1} /> : i + 1}
                  </span>
                  <span className="ob-rail-text">
                    <span className="ob-rail-label">{LABEL[s]}</span>
                    {done && <span className="ob-rail-sub">{summary[s]}</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
        {step === 'ready' && <Qed className="ob-rail-qed" />}
        <button type="button" className="link-button ob-signout" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </aside>

      <main className="ob-main">
        <div className="ob-step" key={step} data-wide={step === 'report' || undefined}>
          {step === 'you' && <You org={org} nav={nav} onNext={next} />}
          {step === 'consent' && <Consent org={org} nav={nav} onNext={next} />}
          {step === 'teaching' && <Teaching org={org} nav={nav} onNext={next} />}
          {step === 'calendar' && <CalendarStep status={calendar} onStatus={setCalendar} nav={nav} onNext={next} />}
          {step === 'parents' && <ParentsStep org={org} answered={steps.indexOf(resume) > at} nav={nav} onNext={next} />}
          {step === 'report' && <ReportStep org={org} nav={nav} onNext={next} />}
          {step === 'ready' && <Ready calendar={calendar} nav={nav} onFinish={finish} />}
        </div>
      </main>
    </div>
  )
}

interface Nav { back?: () => void; busy: boolean; error: string }

function Footer({ nav, children }: { nav: Nav; children: ReactNode }) {
  return (
    <>
      {nav.error && <p className="field-error" role="alert">{nav.error}</p>}
      <div className="ob-footer">
        {nav.back ? <Button variant="ghost" disabled={nav.busy} onClick={nav.back}>Back</Button> : <span />}
        {children}
      </div>
    </>
  )
}

function Head({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <header className="ob-head">
      <h1>{title}</h1>
      {children && <p>{children}</p>}
    </header>
  )
}

function You({ org, nav, onNext }: { org: Org; nav: Nav; onNext: (p: Record<string, unknown>) => void }) {
  const [name, setName] = useState(org.displayName)
  const [business, setBusiness] = useState(org.name)
  const first = name.trim().split(' ')[0]
  return (
    <>
      <Head title={first ? <>Welcome, <span className="serif-em">{first}</span></> : `Welcome to ${BRAND_NAME}`}>
        A few quick questions so {BRAND_NAME} fits how you teach. It takes about a minute, and you can change any answer later in Settings.
      </Head>
      <div className="ob-body">
        <Field label="Your name" hint="Your parent messages end with it.">
          <Input value={name} autoComplete="name" onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Business name" hint="Shown to students and parents.">
          <Input value={business} autoComplete="organization" onChange={(e) => setBusiness(e.target.value)} />
        </Field>
      </div>
      <Footer nav={nav}>
        <Button disabled={nav.busy || !name.trim() || !business.trim()} onClick={() => onNext({ displayName: name.trim(), name: business.trim() })}>Continue</Button>
      </Footer>
    </>
  )
}

function Consent({ org, nav, onNext }: { org: Org; nav: Nav; onNext: (p: Record<string, unknown>) => void }) {
  const [checked, setChecked] = useState(!!org.consentAt)
  return (
    <>
      <Head title="Before you add students">Many tutoring students are children, so please confirm these two things.</Head>
      <div className="ob-body">
        <ul className="consent-list">
          <li>I have a parent's or guardian's permission to use this app with each student under 13: their name, their homework, and photos of their work.</li>
          <li>I'll keep it to what's needed. A first name and last initial is enough, and a student's own email only if they're 13 or older.</li>
        </ul>
        <label className="check-row">
          <input type="checkbox" checked={checked} disabled={!!org.consentAt} onChange={(e) => setChecked(e.target.checked)} />
          I confirm both
        </label>
        <p className="muted">How student information is handled: <Link to="/privacy" target="_blank">Privacy Policy</Link>.</p>
      </div>
      <Footer nav={nav}>
        <Button disabled={nav.busy || !checked} onClick={() => onNext(org.consentAt ? {} : { consent: true })}>Continue</Button>
      </Footer>
    </>
  )
}

function Teaching({ org, nav, onNext }: { org: Org; nav: Nav; onNext: (p: Record<string, unknown>) => void }) {
  const [prefs, setPrefs] = useState({ teachWhere: org.teachWhere, schedule: org.schedule, homeworkDue: org.homeworkDue })
  return (
    <>
      <Head title="How do you teach?">This sets your defaults. Any lesson can still be scheduled, started now or logged afterwards.</Head>
      <div className="ob-body pref-list">
        <Seg label="Where do you teach?" value={prefs.teachWhere} options={WHERE} onChange={(teachWhere) => setPrefs({ ...prefs, teachWhere })} />
        <Seg label="How are lessons booked?" value={prefs.schedule} options={SCHEDULE} onChange={(schedule) => setPrefs({ ...prefs, schedule })} />
        <Seg label="Homework is due" value={prefs.homeworkDue} options={DUE} onChange={(homeworkDue) => setPrefs({ ...prefs, homeworkDue })} />
      </div>
      <Footer nav={nav}><Button disabled={nav.busy} onClick={() => onNext(prefs)}>Continue</Button></Footer>
    </>
  )
}

function CalendarStep({ status, onStatus, nav, onNext }: {
  status: CalendarStatus | null; onStatus: (s: CalendarStatus) => void; nav: Nav; onNext: () => void
}) {
  // Answering "not now" is what lets a tutor on without one: a calendar is
  // never needed, and plenty of tutors don't keep one Slate can read.
  const [later, setLater] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  async function disconnect() {
    setDisconnecting(true)
    try {
      onStatus(await apiFetch('/api/tutor/calendar', { method: 'DELETE' }))
    } finally {
      setDisconnecting(false)
    }
  }
  const sync = status?.lastSync
  const found = (sync?.imported ?? 0) + (sync?.unmatched.length ?? 0)
  return (
    <>
      <Head title="Connect your calendar">Your lessons are probably on a calendar already. Connect it and they come into {BRAND_NAME} by themselves.</Head>
      <div className="ob-body">
        {status === null ? (
          <p className="muted">Checking…</p>
        ) : status.connected ? (
          <div className="cal-done" role="status">
            <span className="step-num" data-done="true"><Check size={14} strokeWidth={3} /></span>
            <div>
              <div className="list-row-title">{status.provider ? PROVIDER_NAME[status.provider] : 'Your calendar'} is connected</div>
              <p className="muted">
                {sync && !sync.ok
                  ? `It connected, but the first sync didn't finish: ${sync.error}. ${BRAND_NAME} tries again each time you open it.`
                  : found
                    ? `${found} event${found === 1 ? '' : 's'} in the next four weeks look${found === 1 ? 's' : ''} like lessons. You'll say who each one is with on This week.`
                    : 'Nothing in the next four weeks looks like a lesson yet. New ones will appear by themselves.'}
              </p>
              <button type="button" className="link-button" disabled={disconnecting} onClick={disconnect}>Use a different calendar</button>
            </div>
          </div>
        ) : (
          <>
            <ul className="ob-facts">
              <li>Lessons for the next four weeks appear on This week, with their meeting links.</li>
              <li>Invites are matched to students by email, so you don't enter anything twice.</li>
              <li>{BRAND_NAME} only reads your calendar. It never adds, changes or deletes anything.</li>
            </ul>
            <CalendarConnect onConnected={onStatus} later={{ chosen: later, choose: setLater }} />
          </>
        )}
      </div>
      <Footer nav={nav}>
        <Button disabled={nav.busy || status === null || (!status.connected && !later)} onClick={() => onNext()}>Continue</Button>
      </Footer>
    </>
  )
}

function ParentsStep({ org, answered, nav, onNext }: { org: Org; answered: boolean; nav: Nav; onNext: (p: Record<string, unknown>) => void }) {
  const [choice, setChoice] = useState<Parents | null>(answered ? parentsChoice(org.parentUpdates) : null)
  return (
    <>
      <Head title="What do parents hear from you?">
        {BRAND_NAME} never sends anything itself. It drafts the message, you check it, then copy it or open it in your own email.
      </Head>
      <div className="ob-body">
        <div className="choice-list" role="radiogroup" aria-label="What parents hear from you">
          {PARENT_CHOICES.map((c) => <Choice key={c.id} selected={choice === c.id} title={c.title} sub={c.sub} onSelect={() => setChoice(c.id)} />)}
        </div>
      </div>
      <Footer nav={nav}>
        <Button disabled={nav.busy || !choice} onClick={() => onNext({ parentUpdates: PARENT_CHOICES.find((c) => c.id === choice)!.prefs })}>Continue</Button>
      </Footer>
    </>
  )
}

// Optional inside a sequence that isn't: the report shows first, and leaving
// it as it is counts as an answer.
function ReportStep({ org, nav, onNext }: { org: Org; nav: Nav; onNext: () => void }) {
  const [editing, setEditing] = useState(false)
  const saved = org.parentTemplates.report
  if (editing) {
    return (
      <>
        <Head title="Make it sound like you">Change anything you like. You can come back to this in Settings, under Parents.</Head>
        <TemplateEditor kind="report" saved={saved} tutorName={org.displayName} footer={({ busy, save }) => (
          <div className="ob-footer">
            <Button variant="ghost" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button>
            <Button disabled={busy || nav.busy} onClick={async () => { if (await save()) onNext() }}>{busy ? 'Saving…' : 'Save and continue'}</Button>
          </div>
        )} />
      </>
    )
  }
  return (
    <>
      <Head title="Here's your progress report">
        {BRAND_NAME} drafts this for each student and fills in the lessons, homework and scores. This one is for a made-up student.
      </Head>
      <div className="ob-body ob-report">
        <TemplatePreview kind="report" template={saved ?? DEFAULT_TEMPLATES.report} tutorName={org.displayName} />
      </div>
      <Footer nav={nav}>
        <div className="ob-footer-end">
          <Button variant="secondary" disabled={nav.busy} onClick={() => setEditing(true)}>Change the wording</Button>
          <Button disabled={nav.busy} onClick={() => onNext()}>Keep this wording</Button>
        </div>
      </Footer>
    </>
  )
}

function Ready({ calendar, nav, onFinish }: { calendar: CalendarStatus | null; nav: Nav; onFinish: (then: () => Promise<string> | string) => void }) {
  return (
    <>
      <Head title={<>You're ready<Qed className="ob-qed" /></>}>
        {calendar?.connected
          ? 'Your calendar is connected. Add your students so each lesson knows who it’s with.'
          : 'Add your first student and they get one private link for homework and lessons.'}
      </Head>
      <div className="ob-body ob-ready">
        <Button disabled={nav.busy} onClick={() => onFinish(() => '/app/students?new=1')}>Add your first student</Button>
        <Button variant="secondary" disabled={nav.busy} onClick={() => onFinish(async () => {
          const { lessonId } = await apiFetch('/api/tutor/demo', { method: 'POST', body: '{}' })
          return `/app/lessons/${lessonId}`
        })}>Explore with a sample student</Button>
        <p className="muted">The sample is a lesson that's already happened, with homework and answers to follow up on. Remove it any time.</p>
      </div>
      <Footer nav={nav}>
        <Button variant="ghost" disabled={nav.busy} onClick={() => onFinish(() => '/app')}>Go to This week</Button>
      </Footer>
    </>
  )
}
