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
  })
})

orgRouter.patch('/org', async (req, res) => {
  const { defaultMeetingUrl } = req.body ?? {}
  if (defaultMeetingUrl !== undefined && defaultMeetingUrl !== null && typeof defaultMeetingUrl !== 'string') {
    return res.status(400).json({ error: 'defaultMeetingUrl must be a string' })
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
