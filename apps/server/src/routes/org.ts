import { Router } from 'express'
import { orgQuery } from '../db.ts'

// The tutor's own workspace settings. orgs is the tenant root, keyed by id,
// so the scoping column is spelled out as `org_id` for orgQuery's guard.
export const orgRouter = Router()

orgRouter.get('/org', async (req, res) => {
  const [org] = await orgQuery<{ name: string; settings: Record<string, unknown>; display_name: string | null }>(
    req.auth!.orgId,
    `select o.name, o.settings, u.display_name
       from orgs o left join users u on u.org_id = o.id and u.id = $2
      where o.id = $1::text /* org_id */`,
    [req.auth!.userId],
  )
  res.json({
    name: org?.name ?? '',
    displayName: org?.display_name ?? '',
    // When the tutor confirmed they have parents' consent for their students (child data, OVERHAUL §5).
    consentAt: typeof org?.settings?.consentAt === 'string' ? org.settings.consentAt : null,
    onboardedAt: onboardedAt(org?.settings ?? {}),
    onboardingStep: ONBOARDING_STEPS.includes(org?.settings?.onboardingStep as never) ? org!.settings.onboardingStep : null,
    // The first real parent update: the last step of getting started.
    parentUpdateSentAt: typeof org?.settings?.parentUpdateSentAt === 'string' ? org.settings.parentUpdateSentAt : null,
    // The sample student, while one exists (routes/demo.ts).
    demo: org?.settings?.demo ? { studentId: (org.settings.demo as { studentId: string }).studentId, lessonId: (org.settings.demo as { lessonId: string }).lessonId, assignmentIds: (org.settings.demo as { assignmentIds: string[] }).assignmentIds } : null,
    defaultMeetingUrl: typeof org?.settings?.defaultMeetingUrl === 'string' ? org.settings.defaultMeetingUrl : '',
    meetingLinkSource: org?.settings?.meetingLinkSource === 'own' ? 'own' : 'invite',
    // Offering Claude drafts is the tutor's choice; some tutors don't want AI at all.
    aiHelp: org?.settings?.aiHelp !== false,
    aiAvailable: !!process.env.ANTHROPIC_API_KEY,
    ...teaching(org?.settings ?? {}),
  })
})

// Setup (/welcome). A tutor who saved or skipped "How do you teach?" on Home,
// before this sequence existed, has finished it; there's nothing to backfill.
const ONBOARDING_STEPS = ['you', 'consent', 'teaching', 'calendar', 'parents', 'report', 'ready'] as const

function onboardedAt(s: Record<string, unknown>): string | null {
  if (typeof s.onboardedAt === 'string') return s.onboardedAt
  return typeof s.consentAt === 'string' && typeof s.teachingAskedAt === 'string' ? s.teachingAskedAt : null
}

// How the tutor teaches (asked in /welcome, editable in Settings). Each
// preference only changes defaults and what's shown; nothing is locked.
const TEACH_WHERE = ['online', 'in_person', 'both'] as const
const SCHEDULE = ['regular', 'as_needed'] as const
const REMINDER = ['none', 'monthly', '4weeks'] as const
const HOMEWORK_DUE = /^(next_lesson|none|in_days:([1-9]|[1-5]\d|60))$/

export function teaching(s: Record<string, unknown>) {
  const pick = <T extends readonly string[]>(v: unknown, of: T, d: T[number]): T[number] => (of.includes(v as string) ? (v as T[number]) : d)
  const pu = (s.parentUpdates ?? {}) as Record<string, unknown>
  const tpl = (s.parentTemplates ?? {}) as Record<string, unknown>
  return {
    teachWhere: pick(s.teachWhere, TEACH_WHERE, 'online'),
    schedule: pick(s.schedule, SCHEDULE, 'regular'),
    homeworkDue: typeof s.homeworkDue === 'string' && HOMEWORK_DUE.test(s.homeworkDue) ? s.homeworkDue : 'next_lesson',
    parentUpdates: {
      afterLesson: pu.afterLesson !== false,
      reports: pu.reports !== false,
      reminder: pick(pu.reminder, REMINDER, 'none'),
    },
    // null = the app's default wording (lessons/template.ts).
    parentTemplates: {
      lesson: typeof tpl.lesson === 'string' ? tpl.lesson : null,
      report: typeof tpl.report === 'string' ? tpl.report : null,
    },
  }
}

async function setSetting(orgId: string, key: string, value: unknown) {
  await orgQuery(
    orgId,
    `update orgs set settings = jsonb_set(settings, $2::text[], $3::jsonb) where id = $1::text /* org_id */`,
    [[key], JSON.stringify(value)],
  )
}

orgRouter.patch('/org', async (req, res) => {
  const { defaultMeetingUrl, meetingLinkSource, aiHelp, name, displayName, consent, teachWhere, schedule, homeworkDue, onboardingStep, onboarded, parentUpdateSent, parentUpdates, parentTemplates } = req.body ?? {}
  if (teachWhere !== undefined && !TEACH_WHERE.includes(teachWhere)) return res.status(400).json({ error: `teachWhere must be one of ${TEACH_WHERE.join(', ')}` })
  if (schedule !== undefined && !SCHEDULE.includes(schedule)) return res.status(400).json({ error: `schedule must be one of ${SCHEDULE.join(', ')}` })
  if (homeworkDue !== undefined && !(typeof homeworkDue === 'string' && HOMEWORK_DUE.test(homeworkDue))) {
    return res.status(400).json({ error: "homeworkDue must be 'next_lesson', 'none' or 'in_days:<1–60>'" })
  }
  if (onboardingStep !== undefined && !ONBOARDING_STEPS.includes(onboardingStep)) {
    return res.status(400).json({ error: `onboardingStep must be one of ${ONBOARDING_STEPS.join(', ')}` })
  }
  if (parentUpdates !== undefined) {
    const p = parentUpdates as Record<string, unknown> | null
    if (!p || typeof p !== 'object' || (p.afterLesson !== undefined && typeof p.afterLesson !== 'boolean')
      || (p.reports !== undefined && typeof p.reports !== 'boolean') || (p.reminder !== undefined && !REMINDER.includes(p.reminder as never))) {
      return res.status(400).json({ error: 'parentUpdates is { afterLesson?: boolean, reports?: boolean, reminder?: none|monthly|4weeks }' })
    }
  }
  if (parentTemplates !== undefined) {
    const t = parentTemplates as Record<string, unknown> | null
    const ok = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.length <= 5000)
    if (!t || typeof t !== 'object' || !ok(t.lesson) || !ok(t.report)) {
      return res.status(400).json({ error: 'parentTemplates is { lesson?: string | null, report?: string | null }, up to 5000 characters each' })
    }
  }
  const orgId = req.auth!.orgId
  if (teachWhere !== undefined) await setSetting(orgId, 'teachWhere', teachWhere)
  if (schedule !== undefined) await setSetting(orgId, 'schedule', schedule)
  if (homeworkDue !== undefined) await setSetting(orgId, 'homeworkDue', homeworkDue)
  if (onboardingStep !== undefined) await setSetting(orgId, 'onboardingStep', onboardingStep)
  if (onboarded === true) {
    // Consent is the one answer that can't be defaulted: it comes before any student.
    const [row] = await orgQuery<{ consent_at: string | null }>(orgId, `select settings->>'consentAt' as consent_at from orgs where id = $1::text /* org_id */`)
    if (!row?.consent_at) return res.status(400).json({ error: 'Confirm the student privacy step first.' })
    await setSetting(orgId, 'onboardedAt', new Date().toISOString())
  }
  if (parentUpdateSent === true) await setSetting(orgId, 'parentUpdateSentAt', new Date().toISOString())
  if (parentUpdates !== undefined || parentTemplates !== undefined) {
    // Merged over what's saved, so one switch or one template saves alone.
    const [row] = await orgQuery<{ settings: Record<string, unknown> }>(orgId, `select settings from orgs where id = $1::text /* org_id */`)
    const cur = teaching(row?.settings ?? {})
    if (parentUpdates !== undefined) await setSetting(orgId, 'parentUpdates', { ...cur.parentUpdates, ...parentUpdates })
    if (parentTemplates !== undefined) await setSetting(orgId, 'parentTemplates', { ...cur.parentTemplates, ...parentTemplates })
  }
  if (name !== undefined && (typeof name !== 'string' || !name.trim())) return res.status(400).json({ error: 'name can’t be blank' })
  if (displayName !== undefined && typeof displayName !== 'string') return res.status(400).json({ error: 'displayName must be a string' })
  if (name !== undefined) {
    await orgQuery(req.auth!.orgId, `update orgs set name = $2 where id = $1::text /* org_id */`, [name.trim().slice(0, 120)])
  }
  if (displayName !== undefined) {
    await orgQuery(req.auth!.orgId, `update users set display_name = $3 where org_id = $1 and id = $2`, [req.auth!.userId, displayName.trim().slice(0, 120) || null])
  }
  if (consent === true) {
    await orgQuery(
      req.auth!.orgId,
      `update orgs set settings = jsonb_set(settings, '{consentAt}', to_jsonb(now()::text)) where id = $1::text /* org_id */`,
    )
  }
  if (aiHelp !== undefined && typeof aiHelp !== 'boolean') return res.status(400).json({ error: 'aiHelp must be true or false' })
  if (meetingLinkSource !== undefined && meetingLinkSource !== 'invite' && meetingLinkSource !== 'own') {
    return res.status(400).json({ error: "meetingLinkSource must be 'invite' or 'own'" })
  }
  if (defaultMeetingUrl !== undefined && defaultMeetingUrl !== null && typeof defaultMeetingUrl !== 'string') {
    return res.status(400).json({ error: 'defaultMeetingUrl must be a string' })
  }
  if (meetingLinkSource !== undefined) {
    // Which link a calendar lesson uses: the invite's own (a fresh Meet per
    // invite) or the student's/tutor's saved link. See routes/sessions.ts.
    await orgQuery(
      req.auth!.orgId,
      `update orgs set settings = jsonb_set(settings, '{meetingLinkSource}', to_jsonb($2::text)) where id = $1::text /* org_id */`,
      [meetingLinkSource],
    )
  }
  if (aiHelp !== undefined) {
    await orgQuery(
      req.auth!.orgId,
      `update orgs set settings = jsonb_set(settings, '{aiHelp}', to_jsonb($2::boolean)) where id = $1::text /* org_id */`,
      [aiHelp],
    )
  }
  if (defaultMeetingUrl !== undefined) {
    const link = typeof defaultMeetingUrl === 'string' && defaultMeetingUrl.trim() ? defaultMeetingUrl.trim() : null
    await orgQuery(
      req.auth!.orgId,
      `update orgs set settings = case when $2::text is null then settings - 'defaultMeetingUrl'
                                        else jsonb_set(settings, '{defaultMeetingUrl}', to_jsonb($2::text)) end
        where id = $1::text /* org_id */`,
      [link],
    )
  }
  res.json({ ok: true })
})
