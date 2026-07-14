// The lesson-plan format is a deliberately GENERIC layout container — it knows
// nothing about pedagogy. It describes only: ordered pages, each holding
// ordered content blocks, each block carrying its own content and the empty
// spacing beneath it (the workspace where live handwritten work lands).
//
// Ported from tittel-tutoring-app/client/src/lesson/schema.ts (+ shared/quiz.ts
// for the answer-format types) so the new lessons table can import/export the
// exact same LessonDoc JSON shape the whiteboard already renders.

/** How a question is answered. 'choice' = multiple choice; 'grid' = SAT grid-in. */
export type AnswerFormat = 'choice' | 'grid'

/**
 * Whether a student learns if they were right.
 * - 'immediate': acked on submit. - 'never': only an explicit tutor reveal opens it up.
 */
export type Reveal = 'immediate' | 'never'

export const DEFAULT_CHOICES = ['A', 'B', 'C', 'D']

export type BlockType = 'latex' | 'text' | 'image'
export type BlockKind = 'heading' | 'body'

/** Resolved answer-collection config for a block; `reveal` is always resolved by parse time. */
export interface LessonAnswer {
  format: AnswerFormat
  key: string
  accept?: string[]
  /** 'choice' only; defaults to DEFAULT_CHOICES. Ignored (and dropped) for 'grid'. */
  choices?: string[]
  reveal: Reveal
}

/** One renderable entity: a problem, a whole problem set, an explanation, or an image. */
export interface LessonBlock {
  type: BlockType
  content?: string
  src?: string
  kind: BlockKind
  spacingAfter: number
  maxWidth: number
  answer?: LessonAnswer
}

export interface LessonPage {
  label: string
  mode?: 'follow' | 'free'
  reveal?: Reveal
  blocks: LessonBlock[]
}

export interface LessonDoc {
  title: string
  pages: LessonPage[]
}

export interface LessonDefaults {
  spacing: number
  maxWidth: number
}

export const LESSON_DEFAULTS: LessonDefaults = {
  spacing: 320,
  maxWidth: 720,
}

export class LessonParseError extends Error {}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}
function asNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}
function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const cleaned = v.filter((s): s is string => typeof s === 'string' && s.trim() !== '')
  return cleaned.length > 0 ? cleaned : undefined
}

/**
 * Answers are compared as strings, but a grid-in answer is naturally authored as
 * a JSON number (`"key": 8`, not `"key": "8"`). Accept both.
 */
function asAnswerString(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return ''
}

function asAnswerStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const cleaned = v.map(asAnswerString).filter((s) => s.trim() !== '')
  return cleaned.length > 0 ? cleaned : undefined
}

/**
 * Present but structurally broken -> throws, because a silently-dropped `key`
 * or `format` would corrupt grading for a whole class. Everything else about
 * `answer` is coerced defensively, in keeping with the rest of this parser.
 */
function parseAnswer(
  raw: unknown,
  pageReveal: Reveal | undefined,
  pi: number,
  bi: number,
): LessonAnswer | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object') {
    throw new LessonParseError(`Block ${bi + 1} on page ${pi + 1} has an invalid "answer".`)
  }
  const a = raw as Record<string, unknown>

  if (a.format !== 'choice' && a.format !== 'grid') {
    throw new LessonParseError(
      `Block ${bi + 1} on page ${pi + 1} answer needs "format" to be "choice" or "grid".`,
    )
  }
  const format = a.format

  const key = asAnswerString(a.key).trim()
  if (!key) {
    throw new LessonParseError(`Block ${bi + 1} on page ${pi + 1} answer needs a non-empty "key".`)
  }

  const accept = asAnswerStringArray(a.accept)
  const choices = format === 'choice' ? (asStringArray(a.choices) ?? [...DEFAULT_CHOICES]) : undefined
  const blockReveal = a.reveal === 'immediate' || a.reveal === 'never' ? a.reveal : undefined
  const reveal: Reveal = blockReveal ?? pageReveal ?? 'never'

  return { format, key, accept, choices, reveal }
}

/**
 * Validate + normalize an untrusted parsed-JSON value into a LessonDoc, filling
 * defaults from the document's own `defaults` block. Throws LessonParseError
 * with a human-readable reason on anything structurally wrong.
 */
export function parseLessonDoc(raw: unknown): LessonDoc {
  if (!raw || typeof raw !== 'object') {
    throw new LessonParseError('Lesson file must be a JSON object.')
  }
  const obj = raw as Record<string, unknown>

  const defaultsRaw = (obj.defaults ?? {}) as Record<string, unknown>
  const defaults: LessonDefaults = {
    spacing: asNumber(defaultsRaw.spacing, LESSON_DEFAULTS.spacing),
    maxWidth: asNumber(defaultsRaw.maxWidth, LESSON_DEFAULTS.maxWidth),
  }

  if (!Array.isArray(obj.pages) || obj.pages.length === 0) {
    throw new LessonParseError('Lesson file needs a non-empty "pages" array.')
  }

  const pages: LessonPage[] = obj.pages.map((p, pi) => {
    if (!p || typeof p !== 'object') {
      throw new LessonParseError(`Page ${pi + 1} must be an object.`)
    }
    const page = p as Record<string, unknown>
    if (!Array.isArray(page.blocks)) {
      throw new LessonParseError(`Page ${pi + 1} needs a "blocks" array.`)
    }
    const mode = page.mode === 'free' || page.mode === 'follow' ? page.mode : undefined
    const pageReveal = page.reveal === 'immediate' || page.reveal === 'never' ? page.reveal : undefined

    const blocks: LessonBlock[] = page.blocks.map((b, bi) => {
      if (!b || typeof b !== 'object') {
        throw new LessonParseError(`Block ${bi + 1} on page ${pi + 1} must be an object.`)
      }
      const block = b as Record<string, unknown>
      const type: BlockType =
        block.type === 'image' || block.type === 'text' ? block.type : 'latex'
      const kind: BlockKind = block.kind === 'heading' ? 'heading' : 'body'

      if (type === 'image') {
        if (!asString(block.src)) {
          throw new LessonParseError(`Image block ${bi + 1} on page ${pi + 1} needs a "src".`)
        }
      } else if (!asString(block.content)) {
        throw new LessonParseError(`Block ${bi + 1} on page ${pi + 1} needs "content".`)
      }

      const answer = parseAnswer(block.answer, pageReveal, pi, bi)

      return {
        type,
        kind,
        content: asString(block.content),
        src: asString(block.src),
        spacingAfter: asNumber(block.spacingAfter, defaults.spacing),
        maxWidth: asNumber(block.maxWidth, defaults.maxWidth),
        answer,
      }
    })

    return { label: asString(page.label, `Page ${pi + 1}`), mode, reveal: pageReveal, blocks }
  })

  return { title: asString(obj.title, 'Lesson'), pages }
}
