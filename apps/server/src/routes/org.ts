import { Router } from 'express'
import { orgQuery } from '../db.ts'

// The tutor's own workspace settings. orgs is the tenant root, keyed by id,
// so the scoping column is spelled out as `org_id` for orgQuery's guard.
export const orgRouter = Router()

orgRouter.get('/org', async (req, res) => {
  const [org] = await orgQuery<{ name: string; settings: Record<string, unknown> }>(
    req.auth!.orgId,
    `select o.name, o.settings from orgs o where o.id = $1::text /* org_id */`,
  )
  res.json({
    name: org?.name ?? '',
    defaultMeetingUrl: typeof org?.settings?.defaultMeetingUrl === 'string' ? org.settings.defaultMeetingUrl : '',
    meetingLinkSource: org?.settings?.meetingLinkSource === 'own' ? 'own' : 'invite',
  })
})

orgRouter.patch('/org', async (req, res) => {
  const { defaultMeetingUrl, meetingLinkSource } = req.body ?? {}
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
