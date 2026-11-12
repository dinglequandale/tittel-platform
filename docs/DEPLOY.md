# DEPLOY: from the repo to a live app

**For:** Konrad, top to bottom. Steps marked **[K]** are yours (accounts, money, decisions); the rest is
already done in the repo. Written 2026-11-12 with LAUNCH.md L3. Placeholders in angle brackets
(`<your-domain>`) are yours to fill in; nothing here names a live service.

## 0. Already done in the repo

- `overhaul` and `master` are on GitHub; CI (typecheck, test, build) passed on Linux.
- `render.yaml` describes the one web service: build, start (applies `db/schema.sql` on every boot),
  health check at `/api/health`, and every env var below.
- `npm test` runs a signed-in suite on a throwaway database (`apps/server/test/stack/`), never on yours.

## 1. Before the first deploy

1. **[K] Read the old boards.** From `apps/server` (its `.env` points at the real database), run:

   ```bash
   npx tsx scripts/board-inventory.ts
   ```

   It is read-only (one `READ ONLY` transaction). It lists how many boards there are, how big they
   are, which tldraw shapes the new board engine drops (frames, embeds, video) or draws as plain
   rectangles (stars, clouds, notes…), and boards near or over the 5 MB save cap. A board over the cap
   will open but won't save until pages are deleted; export those as PDFs first if they matter.
2. **[K] Get the database CA.** Supabase → Project Settings → Database → SSL configuration →
   *Download certificate*. Keep the `.crt` file's text for `DATABASE_CA_CERT` below.
3. **[K] Check backups.** Supabase → Database → Backups. If the plan shows no backups (the free plan
   doesn't keep them), either move to Pro before real students' work goes in, or take a weekly
   `pg_dump` of the session-pooler URL. Each tutor can also download their whole workspace from
   Settings → *Download everything*.

## 2. Render

4. **[K] Create the service.** Render → New → Blueprint → pick this repository. It reads
   `render.yaml` and creates one web service. Then, in the service's Settings, change the instance
   type from **Free** to **Starter** before the first real lesson: free sleeps after 15 idle minutes
   and the first parent to open a link waits about a minute.
5. **[K] Set the environment** (Render → the service → Environment). `BOARD_TOKEN_SECRET`,
   `NODE_VERSION` and `NODE_ENV` are filled in by the blueprint.

   | Key | Value | Needed |
   |---|---|---|
   | `DATABASE_URL` | Supabase → Project Settings → Database → Connection string → **Session pooler** URI (port 5432), password filled in. Leave any `?sslmode=…` off: it overrides the TLS settings below. | yes |
   | `SUPABASE_URL` | Supabase → Project Settings → API → Project URL (`https://<ref>.supabase.co`) | yes |
   | `VITE_SUPABASE_URL` | the same Project URL | yes |
   | `VITE_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → `anon` `public` key | yes |
   | `DATABASE_CA_CERT` | the text of the CA file from step 2, BEGIN/END lines included | recommended |
   | `ANTHROPIC_API_KEY` | Anthropic Console → API Keys | for AI import and drafts |
   | `SENTRY_DSN` | Sentry → a **Node** project → Client Keys (DSN) | optional |
   | `VITE_SENTRY_DSN` | Sentry → a **React** project → Client Keys (DSN) | optional |
   | `VITE_GOOGLE_AUTH` | `on`, only after step 8 enables Google | optional |

   `VITE_*` values are baked in at build time: after changing one, use Manual Deploy → *Clear build
   cache & deploy*.
6. **[K] If the first deploy can't reach the database** with `DATABASE_CA_CERT` set (log line
   `self-signed certificate` or `unable to verify`), set `PGSSLMODE` = `no-verify` to get running,
   and tell the next session: the CA text is probably incomplete. Once a deploy connects with the CA
   and without `PGSSLMODE`, the default in `apps/server/src/lib/dbSsl.ts` can be flipped to verify.

## 3. Supabase and Sentry

7. **[K] Auth URLs.** Supabase → Authentication → URL Configuration:
   - Site URL: `https://<your-domain>` (or `https://<service>.onrender.com` until there is a domain)
   - Redirect URLs: `https://<your-domain>/app` and `https://<your-domain>/reset`
8. **[K] Google sign-in (optional).** Supabase → Authentication → Providers → Google, with a client
   from Google Cloud whose redirect is the callback Supabase shows there. Then set
   `VITE_GOOGLE_AUTH=on` and redeploy.
9. **[K] Sentry (optional).** Two projects, Node and React; their DSNs go in step 5.

## 4. First boot

10. The start command runs `npm run migrate` first, which applies `db/schema.sql` (idempotent). Watch
    the deploy log for `✓ Schema applied.` then `… server listening`. Render marks the deploy live once `/api/health` answers 200.
11. **[K] Smoke test on the live address:** sign up, open `/api/health` (`"ok":true`), create a
    student, open their board, draw, reload: the ink stays.
12. **[K] Old boards.** As each old board is opened for the first time, the log shows
    `[board] <id> imported from tldraw: N shapes, M skipped`. Any error line next to one means that
    board didn't import: note its id. Its original stays in `boards.snapshot`, never overwritten.

## 5. Cutover from the old homework app

No new import code is needed for about ten students; everything below exists in the app.

13. **[K] Students.** Either Settings → Calendar → connect the calendar you teach from (its secret
    iCal address): lessons arrive in the inbox on This week, where each unmatched one can be
    filed under *+ New student or group*; or Students → *New student* → *Paste a list*, one
    student per line: the name, then their email and any parent emails.
14. **[K] Problem sets still in use.** Library → Sets → *Import file (.json)* takes the old app's
    problem-set JSON unchanged, figures included. Import only the sets you will assign again.
15. **[K] New links to families.** Each student's page shows their portal link with a copy button.
    Send it with a line saying the old homework links still work for what's already set.
16. **[K] In-flight homework stays on the old app** until it's handed in and reviewed. Set new
    homework only on the new app from the switch date. When nothing open is left on the old app,
    stop its service.

## 6. Legal drafts: gaps to fill **[K]**

`apps/web/src/marketing/LegalPage.tsx` holds the Privacy Policy and Terms as drafts. Every bracket
in them, and what it needs:

| Where | Gap | Needs |
|---|---|---|
| both | `[date]` (`UPDATED`) | the date the final text takes effect |
| both | `[contact email]` (`CONTACT`) | the address parents and tutors write to |
| both | `[legal name of the business]` (`ENTITY`) | the business's legal name (sole trader name or company) |
| Privacy, "Who else handles it" | `[error monitoring provider, if enabled]` | "Sentry" if the Sentry DSNs are set, else delete the phrase |
| Privacy, "Who else handles it" | `[Where data is stored: region.]` | the Supabase project's region and the Render service's region |
| Privacy, "How long we keep it" | `[… within N days …]` | how many days after an account closes its data is deleted |
| Privacy, "Your choices and rights" | `[Add any rights that apply where you operate …]` | the regimes that apply (UK/EU GDPR, US state laws), ideally with legal advice |
| Terms, "Trial and payment" | `[Pricing, billing, renewal and refund terms.]` | price, billing period, renewal and refund policy (matches the Stripe Payment Link) |
| Terms, "Ending" | `[What happens to data after closing …]` | point at the retention period above |
| Terms, "Liability" | `[Limitation of liability, governing law and jurisdiction …]` | legal advice |

## 7. Still yours before outside tutors (from LAUNCH.md)

- **[K]** The final product name: one line in `packages/shared/src/brand.ts` (`BRAND_NAME`).
- **[K]** The feedback address: `FEEDBACK_EMAIL` in the same file. The in-app "Send feedback" link
  and the landing page's contact line stay hidden while it's empty.
- **[K]** A domain, then step 7's URLs again with it.
- **[K]** The Stripe Payment Link for the founding year, and the list of 5–10 tutors.
