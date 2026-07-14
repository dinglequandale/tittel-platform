// Unified answer grading — replaces the two divergent graders from the
// source repos (tittel-sat-homework/server/grade.ts and
// tittel-tutoring-app/shared/grade.ts). The whiteboard's was newer and
// stricter (0.1% relative tolerance, unicode-minus/en-dash handling,
// `accept[]`, empty-string rejection — PLAN.md §5.3/§9.3), so its algorithm
// is canonical here, generalized to grade against a bank `problems` row
// (type mc|multi|numeric|text|frq, `correct` jsonb, `accept` jsonb[])
// instead of the whiteboard's host-only QuestionKey.

const UNICODE_MINUS_OR_DASH = /[−–]/g

/**
 * Normalizes a raw answer string for comparison: trims, strips all internal
 * whitespace, converts Unicode minus (U+2212) and en-dash (U+2013) to ASCII
 * '-', strips a single leading '+', and strips surrounding parentheses (so
 * "(A)" -> "A"). Does NOT lowercase — callers decide case sensitivity.
 */
export function normalizeAnswer(raw: string): string {
  let s = raw.trim()
  s = s.replace(/\s+/g, '')
  s = s.replace(UNICODE_MINUS_OR_DASH, '-')
  if (s.startsWith('+')) s = s.slice(1)
  if (s.length >= 2 && s.startsWith('(') && s.endsWith(')')) s = s.slice(1, -1)
  return s
}

/** Matches a plain decimal: `8`, `-3.5`, `.5`, with an optional leading '-'. */
const DECIMAL_RE = /^-?\d*\.?\d+$/

/**
 * Parses a grid-in numeric value: either a plain decimal or a simple `a/b`
 * fraction. Returns null when unparseable, including on division by zero
 * and on empty input — checked first, since `Number('')` is 0 in JS and
 * would otherwise silently grade a blank answer as correct.
 */
function parseGridNumber(s: string): number | null {
  if (s === '') return null
  const fraction = s.match(/^(-?\d*\.?\d+)\/(-?\d*\.?\d+)$/)
  if (fraction) {
    if (!DECIMAL_RE.test(fraction[1]) || !DECIMAL_RE.test(fraction[2])) return null
    const num = Number(fraction[1])
    const den = Number(fraction[2])
    if (den === 0) return null
    return num / den
  }
  if (!DECIMAL_RE.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export type ProblemType = 'mc' | 'multi' | 'numeric' | 'text' | 'frq'

export interface GradableProblem {
  type: ProblemType
  /** mc: the correct choice id. multi: array of correct choice ids. numeric/text: the canonical answer. */
  correct: unknown
  /** Extra literal spellings accepted verbatim, beyond numeric/case equivalence. */
  accept?: string[] | null
}

function literalMatch(value: string, key: string, accept: string[] | null | undefined): boolean {
  const v = normalizeAnswer(value).toLowerCase()
  if (v === normalizeAnswer(key).toLowerCase()) return true
  return (accept ?? []).some((a) => v === normalizeAnswer(a).toLowerCase())
}

/**
 * Grades a student's answer against its bank problem. Returns `null` for
 * `frq` (free response) — those are never auto-graded, per PLAN.md §6.5's
 * deferred manual-marking UI; `responses.is_correct` stays null until a
 * tutor marks it.
 */
export function gradeResponse(problem: GradableProblem, answer: unknown): boolean | null {
  if (problem.type === 'frq') return null

  if (problem.type === 'mc') {
    if (typeof answer !== 'string' || typeof problem.correct !== 'string') return false
    return literalMatch(answer, problem.correct, problem.accept)
  }

  if (problem.type === 'multi') {
    const correctIds = Array.isArray(problem.correct) ? problem.correct.map(String) : []
    const answerIds = Array.isArray(answer) ? answer.map(String) : []
    if (correctIds.length === 0) return false
    const normalize = (ids: string[]) => new Set(ids.map((id) => normalizeAnswer(id).toLowerCase()))
    const a = normalize(answerIds)
    const c = normalize(correctIds)
    return a.size === c.size && [...a].every((id) => c.has(id))
  }

  if (typeof answer !== 'string' || typeof problem.correct !== 'string') return false

  if (problem.type === 'text') {
    return literalMatch(answer, problem.correct, problem.accept)
  }

  // 'numeric' (grid-in): literal/accept match, else numeric equivalence
  // within a 0.1% relative tolerance (SAT grid-in truncated-decimal
  // convention — see normalizeAnswer/parseGridNumber doc comments).
  if (literalMatch(answer, problem.correct, problem.accept)) return true
  const v = parseGridNumber(normalizeAnswer(answer))
  const k = parseGridNumber(normalizeAnswer(problem.correct))
  if (v === null || k === null) return false
  return Math.abs(v - k) <= 1e-3 * Math.max(1, Math.abs(k))
}
