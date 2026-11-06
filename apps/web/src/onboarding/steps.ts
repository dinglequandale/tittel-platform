// The order of /welcome and where a tutor picks it up. Pure, so it's tested
// without a browser.

export type StepId = 'you' | 'consent' | 'teaching' | 'calendar' | 'parents' | 'report' | 'ready'

const ORDER: StepId[] = ['you', 'consent', 'teaching', 'calendar', 'parents', 'report', 'ready']

type ParentPrefs = { reports: boolean; reminder: string }

/** The step offering the report's wording is only for tutors who want regular reports. */
export const wantsReports = (p: ParentPrefs) => p.reports && p.reminder !== 'none'

export function stepsFor(p: ParentPrefs): StepId[] {
  return ORDER.filter((s) => s !== 'report' || wantsReports(p))
}

export function stepAfter(step: StepId, p: ParentPrefs): StepId {
  const steps = stepsFor(p)
  return steps[steps.indexOf(step) + 1] ?? 'ready'
}

/** The further of two steps: going back never loses how far the tutor got. */
export function furthest(a: StepId | null, b: StepId): StepId {
  return a && ORDER.indexOf(a) > ORDER.indexOf(b) ? a : b
}

interface Progress {
  onboardingStep: StepId | null
  consentAt: string | null
  parentUpdates: ParentPrefs
}

/**
 * Where a tutor resumes: their saved step, or after what they answered before
 * this sequence existed. Consent comes first, whatever was saved.
 */
export function resumeStep({ onboardingStep, consentAt, parentUpdates }: Progress): StepId {
  if (!onboardingStep) return consentAt ? 'teaching' : 'you'
  if (!consentAt && ORDER.indexOf(onboardingStep) > ORDER.indexOf('consent')) return 'consent'
  return stepsFor(parentUpdates).includes(onboardingStep) ? onboardingStep : 'ready'
}

/** A step from the address (browser back and forward): only ones already reached. */
export function stepToShow(asked: string | null, resume: StepId, p: ParentPrefs): StepId {
  const step = stepsFor(p).find((s) => s === asked)
  return step && ORDER.indexOf(step) <= ORDER.indexOf(resume) ? step : resume
}
