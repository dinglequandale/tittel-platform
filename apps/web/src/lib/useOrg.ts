import { useEffect, useState } from 'react'
import { apiFetch } from './api.ts'
import { supabase } from './supabase.ts'
import type { StepId } from '../onboarding/steps.ts'

/** The tutor's workspace and preferences, as GET /api/tutor/org returns them (routes/org.ts). */
export interface Org {
  name: string
  displayName: string
  consentAt: string | null
  /** Finished /welcome. Until then the app itself is out of reach. */
  onboardedAt: string | null
  onboardingStep: StepId | null
  parentUpdateSentAt: string | null
  demo: { studentId: string; lessonId: string; assignmentIds: string[] } | null
  defaultMeetingUrl: string
  meetingLinkSource: 'invite' | 'own'
  aiHelp: boolean
  aiAvailable: boolean
  teachWhere: 'online' | 'in_person' | 'both'
  schedule: 'regular' | 'as_needed'
  /** 'next_lesson' | 'none' | 'in_days:<n>' */
  homeworkDue: string
  parentUpdates: { afterLesson: boolean; reports: boolean; reminder: 'none' | 'monthly' | '4weeks' }
  parentTemplates: { lesson: string | null; report: string | null }
}

// One fetch shared by every component on the page; saving refreshes all of them.
let cached: Promise<Org> | null = null
const listeners = new Set<(o: Org) => void>()
// A different sign-in is a different workspace.
supabase.auth.onAuthStateChange((event) => { if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') cached = null })

export function loadOrg(): Promise<Org> {
  cached ??= apiFetch('/api/tutor/org').catch((err) => { cached = null; throw err })
  return cached
}

/** Saves preferences (PATCH /api/tutor/org) and updates every useOrg on the page. */
export async function saveOrg(patch: Record<string, unknown>): Promise<Org> {
  await apiFetch('/api/tutor/org', { method: 'PATCH', body: JSON.stringify(patch) })
  cached = null
  const org = await loadOrg()
  listeners.forEach((l) => l(org))
  return org
}

export function useOrg(): Org | null {
  const [org, setOrg] = useState<Org | null>(null)
  useEffect(() => {
    let live = true
    loadOrg().then((o) => live && setOrg(o)).catch(() => {})
    listeners.add(setOrg)
    return () => { live = false; listeners.delete(setOrg) }
  }, [])
  return org
}
