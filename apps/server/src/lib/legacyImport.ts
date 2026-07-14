import { newId } from '@tittel/shared'
import type { LegacyProblemSet } from '@tittel/shared'
import { pool } from '../db.ts'
import { renderFigures } from './tikz.ts'
import { validateLegacySet } from './legacyValidate.ts'

export class ImportError extends Error {
  constructor(public errors: string[]) {
    super(errors[0] ?? 'invalid problem set')
    this.name = 'ImportError'
  }
}

export interface ImportResult {
  setId: string
  title: string
  problems: number
  figures: number
}

/**
 * Fold a legacy tittel-sat-homework problem-set JSON onto the new bank+set
 * shape: problems become first-class, reusable bank rows (their own nanoid
 * PK), and the set references them via `set_problems`. Unlike the legacy
 * CLI's `push`, this is a one-shot import triggered from the UI — re-running
 * it on the same file creates new bank problems rather than upserting in
 * place (the legacy slug-based idempotency doesn't carry over cleanly to a
 * multi-tenant, reusable-problem bank; re-importing is rare enough that this
 * is an acceptable v1 simplification).
 */
export async function importLegacyProblemSet(orgId: string, set: LegacyProblemSet): Promise<ImportResult> {
  const errors = validateLegacySet(set)
  if (errors.length) throw new ImportError(errors)

  let figureCount = 0
  const client = await pool.connect()
  try {
    await client.query('begin')

    const setId = newId()
    await client.query(
      `insert into problem_sets (id, org_id, title, template) values ($1, $2, $3, 'neutral')`,
      [setId, orgId, set.title],
    )

    for (let i = 0; i < set.problems.length; i++) {
      const p = set.problems[i]
      const figures = await renderFigures(p.figures)
      figureCount += figures.length

      const type = p.type === 'mc' ? 'mc' : 'numeric'
      const correct = p.type === 'mc' ? JSON.stringify(p.correct ?? null) : JSON.stringify(p.answers?.[0] ?? null)
      const accept = p.type === 'mc' ? '[]' : JSON.stringify(p.answers ?? [])

      const problemId = newId()
      await client.query(
        `insert into problems
           (id, org_id, type, stem_latex, choices, correct, accept, explanation_latex, figures, source)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          problemId,
          orgId,
          type,
          p.stem,
          JSON.stringify(p.choices ?? []),
          correct,
          accept,
          p.explanation ?? null,
          JSON.stringify(figures),
          `import:${set.title}`,
        ],
      )
      await client.query(
        `insert into set_problems (set_id, problem_id, ordinal) values ($1, $2, $3)`,
        [setId, problemId, i],
      )
    }

    await client.query('commit')
    return { setId, title: set.title, problems: set.problems.length, figures: figureCount }
  } catch (e) {
    await client.query('rollback')
    throw e
  } finally {
    client.release()
  }
}
