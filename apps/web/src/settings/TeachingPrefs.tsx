import { useEffect, useState } from 'react'
import { saveOrg, type Org } from '../lib/useOrg.ts'
import { useToast } from '../lib/toast.tsx'

type Prefs = Pick<Org, 'teachWhere' | 'schedule' | 'homeworkDue'>

export const WHERE: [Org['teachWhere'], string][] = [['online', 'Online'], ['in_person', 'In person'], ['both', 'Both']]
export const SCHEDULE: [Org['schedule'], string][] = [['regular', 'Regular weekly slots'], ['as_needed', 'As needed']]
export const DUE: [string, string][] = [
  ['next_lesson', 'At the next lesson'], ['in_days:3', '3 days later'], ['in_days:7', 'A week later'],
  ['in_days:14', 'Two weeks later'], ['none', 'No due date'],
]

export function Seg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
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
 * links, Start now, when homework is due); nothing is locked. First asked in
 * /welcome; here in Settings each choice saves itself.
 */
export function TeachingPrefs({ org }: { org: Org }) {
  const toast = useToast()
  const [prefs, setPrefs] = useState<Prefs>({ teachWhere: org.teachWhere, schedule: org.schedule, homeworkDue: org.homeworkDue })
  useEffect(() => setPrefs({ teachWhere: org.teachWhere, schedule: org.schedule, homeworkDue: org.homeworkDue }), [org])

  async function set(patch: Partial<Prefs>) {
    setPrefs((p) => ({ ...p, ...patch }))
    try {
      await saveOrg(patch)
    } catch (err) {
      toast((err as Error).message)
    }
  }

  return (
    <div className="pref-list">
      <Seg label="Where do you teach?" value={prefs.teachWhere} options={WHERE} onChange={(teachWhere) => set({ teachWhere })} />
      <Seg label="How are lessons booked?" value={prefs.schedule} options={SCHEDULE} onChange={(schedule) => set({ schedule })} />
      <Seg label="Homework is due" value={prefs.homeworkDue} options={DUE} onChange={(homeworkDue) => set({ homeworkDue })} />
    </div>
  )
}
