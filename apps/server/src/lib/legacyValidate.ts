import type { LegacyProblemSet, LegacyProblem } from '@tittel/shared'

// Ported from tittel-sat-homework/server/validate.ts — validates the legacy
// authoring JSON shape before it touches figure rendering or the DB.
export function validateLegacySet(set: unknown): string[] {
  const errors: string[] = []
  if (typeof set !== 'object' || set === null) {
    return ['Top-level value must be an object.']
  }
  const s = set as Partial<LegacyProblemSet>

  if (!isNonEmptyString(s.title)) errors.push('`title` must be a non-empty string.')

  if (!Array.isArray(s.problems) || s.problems.length === 0) {
    errors.push('`problems` must be a non-empty array.')
    return errors
  }

  const seen = new Set<string>()
  s.problems.forEach((p, i) => validateProblem(p, i, seen, errors))
  return errors
}

function validateProblem(p: LegacyProblem, i: number, seen: Set<string>, errors: string[]) {
  const at = `problems[${i}]`
  if (typeof p !== 'object' || p === null) {
    errors.push(`${at} must be an object.`)
    return
  }
  if (!isNonEmptyString(p.id)) errors.push(`${at}.id must be a non-empty string.`)
  else {
    if (seen.has(p.id)) errors.push(`${at}.id "${p.id}" is duplicated.`)
    seen.add(p.id)
  }
  if (!isNonEmptyString(p.stem)) errors.push(`${at} (${p.id}) needs a non-empty stem.`)

  if (p.type === 'mc') {
    if (!Array.isArray(p.choices) || p.choices.length < 2) {
      errors.push(`${at} (${p.id}) mc needs >= 2 choices.`)
    } else {
      const ids = new Set<string>()
      p.choices.forEach((c, j) => {
        if (!isNonEmptyString(c?.id)) errors.push(`${at}.choices[${j}] needs an id.`)
        else if (ids.has(c.id)) errors.push(`${at} (${p.id}) choice id "${c.id}" duplicated.`)
        else ids.add(c.id)
        if (!isNonEmptyString(c?.content)) errors.push(`${at}.choices[${j}] needs content.`)
      })
      if (!isNonEmptyString(p.correct)) errors.push(`${at} (${p.id}) mc needs \`correct\`.`)
      else if (!ids.has(p.correct)) errors.push(`${at} (${p.id}) correct "${p.correct}" is not a choice id.`)
    }
  } else if (p.type === 'grid') {
    if (!Array.isArray(p.answers) || p.answers.length === 0 || !p.answers.every(isNonEmptyString)) {
      errors.push(`${at} (${p.id}) grid needs a non-empty \`answers\` array of strings.`)
    }
  } else {
    errors.push(`${at} (${p.id}) type must be "mc" or "grid".`)
  }

  const defined = new Set<string>()
  ;(p.figures ?? []).forEach((f, j) => {
    if (!isNonEmptyString(f?.id)) errors.push(`${at}.figures[${j}] needs an id.`)
    else if (defined.has(f.id)) errors.push(`${at} (${p.id}) figure id "${f.id}" duplicated.`)
    else defined.add(f.id)
    if (!isNonEmptyString(f?.latex)) errors.push(`${at}.figures[${j}] (${f?.id}) needs latex.`)
  })
  const refs = collectFigRefs(p)
  for (const ref of refs) {
    if (!defined.has(ref)) errors.push(`${at} (${p.id}) references missing figure "![${ref}]".`)
  }
}

const FIG_REF = /!\[([^\]]+)\]/g

function collectFigRefs(p: LegacyProblem): Set<string> {
  const refs = new Set<string>()
  const scan = (text?: string) => {
    if (!text) return
    for (const m of text.matchAll(FIG_REF)) refs.add(m[1])
  }
  scan(p.stem)
  scan(p.explanation)
  ;(p.choices ?? []).forEach((c) => scan(c.content))
  return refs
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}
