import { useEffect, useState } from 'react'
import { Button } from '@tittel/ui'
import { saveOrg, type Org } from '../lib/useOrg.ts'
import { useToast } from '../lib/toast.tsx'

type Prefs = Pick<Org, 'teachWhere' | 'schedule' | 'homeworkDue'>
type Parents = 'lesson' | 'monthly' | 'both' | 'self'

const WHERE: [Org['teachWhere'], string][] = [['online', 'Online'], ['in_person', 'In person'], ['both', 'Both']]
const SCHEDULE: [Org['schedule'], string][] = [['regular', 'Regular weekly slots'], ['as_needed', 'As needed']]
const DUE: [string, string][] = [
  ['next_lesson', 'At the next lesson'], ['in_days:3', '3 days later'], ['in_days:7', 'A week later'],
  ['in_days:14', 'Two weeks later'], ['none', 'No due date'],
]
const PARENTS: [Parents, string][] = [
  ['lesson', 'A note after each lesson'], ['monthly', 'A monthly report'], ['both', 'Both'], ['self', 'I handle that myself'],
]
const PARENT_PREFS: Record<Parents, Org['parentUpdates']> = {
  lesson: { afterLesson: true, reports: true, reminder: 'none' },
  monthly: { afterLesson: false, reports: true, reminder: 'monthly' },
  both: { afterLesson: true, reports: true, reminder: 'monthly' },
  self: { afterLesson: false, reports: false, reminder: 'none' },
}

function Seg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="pref-row">
      <div className="list-row-title">{label}</div>
      <div className="seg" role="radiogroup" aria-label={label}>
        {options.map(([v, text]) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} data-active={value === v} onClick={() => onChange(v)}>{text}</button>
        ))}
      </div>
    </div>
  )
}

/**
 * How the tutor teaches. These only set defaults and what's shown (meeting
 * links, Start now, when homework is due, parent updates); nothing is locked.
 * On Home it's asked once with Save/Skip; in Settings each choice saves itself.
 */
export function TeachingPrefs({ org, onboarding, onDone }: { org: Org; onboarding?: boolean; onDone?: () => void }) {
  const toast = useToast()
  const [prefs, setPrefs] = useState<Prefs>({ teachWhere: org.teachWhere, schedule: org.schedule, homeworkDue: org.homeworkDue })
  const [parents, setParents] = useState<Parents>('lesson')
  const [busy, setBusy] = useState(false)
  useEffect(() => setPrefs({ teachWhere: org.teachWhere, schedule: org.schedule, homeworkDue: org.homeworkDue }), [org])

  async function set(patch: Partial<Prefs>) {
    setPrefs((p) => ({ ...p, ...patch }))
    if (onboarding) return
    try {
      await saveOrg(patch)
    } catch (err) {
      toast((err as Error).message)
    }
  }

  async function finish(save: boolean) {
    setBusy(true)
    try {
      await saveOrg(save ? { ...prefs, parentUpdates: PARENT_PREFS[parents], teachingAsked: true } : { teachingAsked: true })
      onDone?.()
    } catch (err) {
      toast((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="pref-list">
      <Seg label="Where do you teach?" value={prefs.teachWhere} options={WHERE} onChange={(teachWhere) => set({ teachWhere })} />
      <Seg label="How are lessons booked?" value={prefs.schedule} options={SCHEDULE} onChange={(schedule) => set({ schedule })} />
      <Seg label="Homework is due" value={prefs.homeworkDue} options={DUE} onChange={(homeworkDue) => set({ homeworkDue })} />
      {onboarding && <Seg label="What do parents hear from you?" value={parents} options={PARENTS} onChange={setParents} />}
      {onboarding && (
        <div className="row-end">
          <Button variant="ghost" disabled={busy} onClick={() => finish(false)}>Skip</Button>
          <Button disabled={busy} onClick={() => finish(true)}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      )}
    </div>
  )
}
