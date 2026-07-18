# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

## Project facts (Slate / tittel-platform)

- **Run:** `npm run dev` (server + web together), `npm run typecheck`, `npm test`, `npm run build`, `npm run migrate`. Monorepo via npm workspaces (`apps/*`, `packages/*`); `apps/server` runs on `tsx` directly, no build step.
- **Tenancy rule:** every tenant-owned query goes through `orgQuery`/`studentQuery`/`attemptQuery` in `apps/server/src/db.ts` — each regex-checks the SQL references its scoping column (`org_id` / `portal_token` / `attempt_token`) and throws if not. Raw `pool.query` is reserved for `db.ts`/`migrate.ts`. Never bypass this for a "quick" query.
- **Schema migrations:** `db/schema.sql` uses `create table if not exists` throughout. New columns go in the `-- migrations (idempotent)` section at the bottom as `alter table ... add column if not exists ...` — the schema file is applied repeatedly, not versioned.
- **AI import:** the lesson-plan/worksheet import feature (`apps/server/src/routes/aiImport.ts`) is gated on `ANTHROPIC_API_KEY` — unset means the feature reports `enabled:false` and its routes 404/disable client-side, not an error.