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
    // The sample student, while one exists (routes/demo.ts).
    demo: org?.settings?.demo ? { studentId: (org.settings.demo as { studentId: string }).studentId, lessonId: (org.settings.demo as { lessonId: string }).lessonId, assignmentIds: (org.settings.demo as { assignmentIds: string[] }).assignmentIds } : null,
    defaultMeetingUrl: typeof org?.settings?.defaultMeetingUrl === 'string' ? org.settings.defaultMeetingUrl : '',
    meetingLinkSource: org?.settings?.meetingLinkSource === 'own' ? 'own' : 'invite',
    // Offering Claude drafts is the tutor's choice; some tutors don't want AI at all.
    aiHelp: org?.settings?.aiHelp !== false,
    aiAvailable: !!process.env.ANTHROPIC_API_KEY,
  })
})

orgRouter.patch('/org', async (req, res) => {
  const { defaultMeetingUrl, meetingLinkSource, aiHelp, name, displayName, consent } = req.body ?? {}
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
