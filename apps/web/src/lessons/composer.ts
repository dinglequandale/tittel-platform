import type { LessonBlock, LessonDoc } from '@tittel/shared'
import type { AiImportDraft } from '../content/AiImportReview.tsx'

// Turning what a tutor already has into a plan or a homework set, without
// any special format: text typed or pasted (say, from ChatGPT or a doc) and
// files (PDF pages, photos). Pure, so it's easy to test.

type DraftProblem = AiImportDraft['problems'][number]

/** ChatGPT and Word write math as \( \) and \[ \]; the app reads $ $ and $$ $$. */
export function normalizeMath(text: string): string {
  return text
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `$$${m.trim()}$$`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => `$${m.trim()}$`)
}

const ANSWER_LINE = /^\s*(?:\*\*)?(?:answer|ans|solution)(?:\*\*)?\s*[:=-]\s*(.+?)\s*$/i
const KEY_HEADING = /^\s*(?:#+\s*)?\**\s*(?:answers?|answer key|solutions?|key)\s*:?\s*\**\s*:?\s*$/i
/** "Answers: 1) 6  2) 5√2": the key on the heading's own line. Plural only, so "Answer: 3.5" stays one problem's answer. */
const KEY_INLINE = /^\s*(?:#+\s*)?\**\s*(?:answers|answer key|solutions|key)\s*\**\s*:\s*\**\s*(\d{1,3}\s*[.):].*)$/i
const NUMBERED = /^\s*(?:#+\s*)?(?:\*\*)?(?:q(?:uestion)?\s*|problem\s*)?(\d{1,3})(?:\*\*)?\s*[.):]\s*(?:\*\*)?\s*/i
const CHOICE_LINE = /^\s*\(?([A-Ea-e])[).:]\s+(.+)$/
const NUMERIC = /^[-+]?(\d[\d,]*\.?\d*|\.\d+)(\/\d+)?$/

function answerKind(answer: string, choiceIds: string[]): Pick<DraftProblem, 'type' | 'correct'> {
  const a = answer.replace(/^\(?([A-Ea-e])\)?[.)]?$/, '$1').trim()
  if (choiceIds.length && /^[A-Ea-e]$/.test(a)) return { type: 'mc', correct: a.toUpperCase() }
  if (NUMERIC.test(answer.replace(/^[a-z]\s*=\s*/i, '').replace(/\s/g, ''))) return { type: 'numeric', correct: answer.replace(/^[a-z]\s*=\s*/i, '').replace(/\s/g, '') }
  return { type: 'text', correct: answer }
}

/** "1. 4   2) (x+2)(x+3)   3: B" or one per line: answers by question number. */
function parseKey(lines: string[]): Map<number, string> {
  const key = new Map<number, string>()
  const text = lines.join('\n')
  const re = /(?:^|\s)(\d{1,3})\s*[.):]\s*(.+?)(?=\s+\d{1,3}\s*[.):]\s|\n|$)/g
  for (const m of text.matchAll(re)) key.set(Number(m[1]), m[2].trim())
  return key
}

/**
 * Problems from plain text. Numbered problems ("1.", "2)", "Q3:") or, without
 * numbers, blocks separated by blank lines. "Answer: …" under a problem, or an
 * "Answers" section at the end, gives the answer; lettered lines are choices.
 * A problem with no answer becomes a free response the tutor marks.
 */
export function draftFromText(raw: string, title: string): AiImportDraft {
  const lines = normalizeMath(raw).replace(/\r/g, '').split('\n')
  const keyAt = lines.findIndex((l) => KEY_HEADING.test(l) || KEY_INLINE.test(l))
  const body = keyAt >= 0 ? lines.slice(0, keyAt) : lines
  const inline = keyAt >= 0 ? lines[keyAt].match(KEY_INLINE)?.[1] : undefined
  const key = keyAt >= 0 ? parseKey([...(inline ? [inline] : []), ...lines.slice(keyAt + 1)]) : new Map<number, string>()

  const chunks: { n: number | null; lines: string[] }[] = []
  const numbered = body.some((l) => NUMBERED.test(l))
  for (const line of body) {
    const m = numbered ? line.match(NUMBERED) : null
    if (m) chunks.push({ n: Number(m[1]), lines: [line.slice(m[0].length)] })
    else if (numbered) { if (chunks.length) chunks[chunks.length - 1].lines.push(line) }
    else if (!line.trim()) chunks.push({ n: null, lines: [] })
    else if (!chunks.length) chunks.push({ n: null, lines: [line] })
    else chunks[chunks.length - 1].lines.push(line)
  }

  const problems: DraftProblem[] = []
  chunks.forEach((c, i) => {
    let answer: string | null = null
    const choices: { id: string; content: string }[] = []
    const stem: string[] = []
    for (const line of c.lines) {
      const a = line.match(ANSWER_LINE)
      const ch = line.match(CHOICE_LINE)
      if (a) answer = a[1].replace(/\*\*/g, '').trim()
      else if (ch) choices.push({ id: ch[1].toUpperCase(), content: ch[2].trim() })
      else stem.push(line)
    }
    // "A) 2  B) 3  C) 4" written on one line.
    if (!choices.length) {
      const last = stem.length ? stem[stem.length - 1] : ''
      const inline = [...last.matchAll(/\(?([A-E])\)\s*([^()]+?)(?=\s+\(?[A-E]\)|$)/g)]
      if (inline.length >= 2 && inline[0][1] === 'A') {
        const question = last.slice(0, inline[0].index).trim()
        stem.pop()
        if (question) stem.push(question)
        for (const m of inline) choices.push({ id: m[1], content: m[2].trim() })
      }
    }
    const text = stem.join('\n').trim()
    if (!text) return
    answer = answer ?? (c.n !== null ? key.get(c.n) ?? null : key.get(i + 1) ?? null)
    if (!answer) {
      problems.push({ type: 'frq', stemLatex: text, choices: choices.length ? choices : undefined, correct: null, answerConfidence: 'missing' })
      return
    }
    const kind = answerKind(answer, choices.map((x) => x.id))
    problems.push({
      ...kind,
      stemLatex: text,
      choices: kind.type === 'mc' ? choices : undefined,
      answerConfidence: 'found',
    })
  })
  return { title: title.trim() || 'Homework', problems }
}

const PROBLEM_SPACING = 320
const TEXT_SPACING = 60

/**
 * A plan from text: "---" starts a new board page, blank lines separate
 * blocks, "# " makes a heading, and "Answer: …" under a block gives it an
 * answer box (a letter for multiple choice, otherwise a typed answer).
 */
export function planFromText(raw: string, title: string): LessonDoc {
  const pages = normalizeMath(raw).replace(/\r/g, '').split(/^\s*-{3,}\s*$/m)
  return {
    title: title.trim() || 'Plan',
    pages: pages.map((pageText, pi) => {
      // A heading is its own block even with text right under it.
      const blocks: LessonBlock[] = pageText.replace(/^(#+\s+.*)$/gm, '$1\n').split(/\n\s*\n/).map((chunk) => chunk.trim()).filter(Boolean).map((chunk) => {
        const lines = chunk.split('\n')
        const answerLine = lines.find((l) => ANSWER_LINE.test(l))
        const content = lines.filter((l) => l !== answerLine).join('\n').trim()
        const heading = /^#+\s+/.test(content)
        const block: LessonBlock = {
          type: 'text',
          kind: heading ? 'heading' : 'body',
          content: heading ? content.replace(/^#+\s+/, '') : content,
          spacingAfter: answerLine || NUMBERED.test(content) ? PROBLEM_SPACING : TEXT_SPACING,
          maxWidth: 720,
        }
        if (answerLine) {
          const answer = answerLine.match(ANSWER_LINE)![1].replace(/\*\*/g, '').trim()
          const letter = answer.match(/^\(?([A-Ea-e])\)?$/)
          block.answer = letter
            ? { format: 'choice', key: letter[1].toUpperCase(), choices: ['A', 'B', 'C', 'D'], reveal: 'never' }
            : { format: 'grid', key: answer.replace(/^[a-z]\s*=\s*/i, ''), reveal: 'never' }
        }
        return block
      }).filter((b) => b.content)
      return { label: `Page ${pi + 1}`, blocks }
    }).filter((p) => p.blocks.length),
  }
}

/** A plan whose pages are images (PDF pages, photos): one per board page, no workspace gap. */
export function planFromImages(urls: string[], title: string): LessonDoc {
  return {
    title: title.trim() || 'Plan',
    pages: urls.map((src, i) => ({
      label: `Page ${i + 1}`,
      blocks: [{ type: 'image', kind: 'body', src, content: '', spacingAfter: 40, maxWidth: 900 }],
    })),
  }
}
