import { Router } from 'express'
import express from 'express'
import Anthropic, { APIError } from '@anthropic-ai/sdk'
import mammoth from 'mammoth'
import { newId } from '@tittel/shared'
import { pool } from '../db.ts'

export const aiImportRouter = Router()

// Deliberate lightweight model choice (HANDOFF.md E2) — a worksheet-extraction
// task doesn't need frontier reasoning, and Haiku keeps a 10-page import well
// under $0.01. Bump to claude-sonnet-5 here if extraction quality is ever
// insufficient; nothing else in this file needs to change.
const AI_IMPORT_MODEL = 'claude-haiku-4-5'

let client: Anthropic | null = null
function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null
  if (!client) client = new Anthropic()
  return client
}

aiImportRouter.get('/ai-import/status', (_req, res) => {
  res.json({ enabled: !!process.env.ANTHROPIC_API_KEY })
})

const DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'problems'],
  properties: {
    title: { type: 'string' },
    problems: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'stemLatex'],
        properties: {
          type: { enum: ['mc', 'multi', 'numeric', 'text', 'frq'] },
          stemLatex: { type: 'string' },
          choices: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'content'],
              properties: { id: { type: 'string' }, content: { type: 'string' } },
            },
          },
          correct: { type: ['string', 'null'] },
          correctMulti: { type: 'array', items: { type: 'string' } },
          accept: { type: 'array', items: { type: 'string' } },
          explanationLatex: { type: ['string', 'null'] },
          answerConfidence: { enum: ['found', 'inferred', 'missing'] },
        },
      },
    },
  },
} as const

const SYSTEM_PROMPT = `You convert a tutor's uploaded lesson plan or worksheet document into a structured problem-bank draft.

Rules:
- Convert all math to KaTeX: inline as $...$, display as $$...$$.
- Preserve the order problems appear in the document.
- If the document includes an answer key, match each answer to its problem and set answerConfidence to "found".
- If a problem's answer is worked out in the body text but not present in a separate key, set answerConfidence to "inferred".
- If no answer can be determined, set answerConfidence to "missing" and leave correct null.
- Questions that require shown work or an open-ended written response (not matchable to a single choice/value) must use type "frq".
- For type "mc", set choices and correct (the correct choice id).
- For type "multi", set choices and correctMulti (array of correct choice ids).
- For type "numeric" or "text", set correct to the canonical answer string; use accept for equivalent alternate spellings if given.
- Never invent choices that are not present in the document.
- Figures and diagrams cannot be imported. Where the stem references one, append "[figure not imported]" to the stem text.
- Output only the title and problems array — no commentary.`

interface DraftChoice { id: string; content: string }
interface DraftProblem {
  type: 'mc' | 'multi' | 'numeric' | 'text' | 'frq'
  stemLatex: string
  choices?: DraftChoice[]
  correct?: string | null
  correctMulti?: string[]
  accept?: string[]
  explanationLatex?: string | null
  answerConfidence: 'found' | 'inferred' | 'missing'
}
interface Draft { title: string; problems: DraftProblem[] }

function isDocxMime(mimeType: string, filename: string): boolean {
  return (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    filename.toLowerCase().endsWith('.docx')
  )
}

async function extractContentBlock(
  filename: string,
  mimeType: string,
  dataBase64: string,
): Promise<{ type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } } | { type: 'text'; text: string }> {
  if (mimeType === 'application/pdf' || filename.toLowerCase().endsWith('.pdf')) {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: dataBase64 } }
  }
  if (isDocxMime(mimeType, filename)) {
    const buffer = Buffer.from(dataBase64, 'base64')
    const { value } = await mammoth.extractRawText({ buffer })
    return { type: 'text', text: value }
  }
  if (mimeType === 'text/plain' || mimeType === 'text/markdown' || /\.(txt|md)$/i.test(filename)) {
    return { type: 'text', text: Buffer.from(dataBase64, 'base64').toString('utf-8') }
  }
  throw Object.assign(new Error(`unsupported file type: ${mimeType || filename}`), { status: 415 })
}

// Route-level parser: this is the one endpoint that needs a larger body limit
// (a 30MB PDF is ~40MB once base64-encoded); app.ts excludes this exact path
// from the global express.json() so this is the only parser that sees it.
aiImportRouter.post('/ai-import', express.json({ limit: '40mb' }), async (req, res) => {
  const anthropic = getClient()
  if (!anthropic) return res.status(503).json({ error: 'AI import is not configured' })

  const { filename, mimeType, dataBase64, hint } = req.body ?? {}
  if (typeof filename !== 'string' || typeof mimeType !== 'string' || typeof dataBase64 !== 'string') {
    return res.status(400).json({ error: 'filename, mimeType, and dataBase64 are required' })
  }

  let contentBlock
  try {
    contentBlock = await extractContentBlock(filename, mimeType, dataBase64)
  } catch (err) {
    const status = (err as { status?: number }).status ?? 400
    return res.status(status).json({ error: (err as Error).message })
  }

  const userText = hint && typeof hint === 'string' && hint.trim()
    ? `Tutor's hint: ${hint.trim()}`
    : 'Extract every problem from this document.'

  try {
    const message = await anthropic.messages.create({
      model: AI_IMPORT_MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      output_config: { format: { type: 'json_schema', schema: DRAFT_SCHEMA } },
      messages: [
        {
          role: 'user',
          content: [contentBlock as never, { type: 'text', text: userText }],
        },
      ],
    })
    const textBlock = message.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
    if (!textBlock) return res.status(502).json({ error: 'AI import returned no output' })
    const draft = JSON.parse(textBlock.text) as Draft
    res.json({ draft })
  } catch (err) {
    if (err instanceof APIError) {
      return res.status(502).json({ error: `AI import failed: ${err.message}` })
    }
    throw err
  }
})

const PROBLEM_TYPES = ['mc', 'multi', 'numeric', 'text', 'frq']

// Validates a (possibly tutor-edited) draft problem before it's written to
// the bank — mirrors the constraints problems.ts enforces on direct writes.
function validateDraftProblem(p: unknown, index: number): string | null {
  if (!p || typeof p !== 'object') return `problem ${index + 1}: not an object`
  const problem = p as Record<string, unknown>
  if (!PROBLEM_TYPES.includes(problem.type as string)) return `problem ${index + 1}: invalid type`
  if (typeof problem.stemLatex !== 'string' || !problem.stemLatex.trim()) {
    return `problem ${index + 1}: stemLatex is required`
  }
  if (problem.type === 'multi' && problem.correctMulti !== undefined && !Array.isArray(problem.correctMulti)) {
    return `problem ${index + 1}: correctMulti must be an array`
  }
  return null
}

// Commits a (possibly tutor-edited) draft: creates bank problems + a new set
// referencing them, in one transaction. Nothing is written before this call.
aiImportRouter.post('/ai-import/commit', async (req, res) => {
  const { title, problems, filename } = req.body ?? {}
  if (typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'title is required' })
  }
  if (!Array.isArray(problems) || problems.length === 0) {
    return res.status(400).json({ error: 'problems must be a non-empty array' })
  }
  for (let i = 0; i < problems.length; i++) {
    const err = validateDraftProblem(problems[i], i)
    if (err) return res.status(422).json({ error: err })
  }

  const orgId = req.auth!.orgId
  const source = `ai-import:${typeof filename === 'string' && filename ? filename : 'untitled'}`

  const client2 = await pool.connect()
  try {
    await client2.query('begin')

    const setId = newId()
    await client2.query(
      `insert into problem_sets (id, org_id, title) values ($1, $2, $3)`,
      [setId, orgId, title.trim()],
    )

    const createdProblems: unknown[] = []
    let ordinal = 0
    for (const raw of problems as DraftProblem[]) {
      const problemId = newId()
      const correct =
        raw.type === 'multi' ? (raw.correctMulti ?? []) : raw.correct ?? null
      await client2.query(
        `insert into problems
           (id, org_id, type, stem_latex, choices, correct, accept, explanation_latex, source)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          problemId,
          orgId,
          raw.type,
          raw.stemLatex.trim(),
          JSON.stringify(raw.choices ?? []),
          JSON.stringify(correct),
          JSON.stringify(raw.accept ?? []),
          raw.explanationLatex || null,
          source,
        ],
      )
      await client2.query(
        `insert into set_problems (set_id, problem_id, ordinal) values ($1, $2, $3)`,
        [setId, problemId, ordinal++],
      )
      createdProblems.push({ id: problemId, type: raw.type, stemLatex: raw.stemLatex })
    }

    await client2.query('commit')
    res.status(201).json({ setId, problems: createdProblems })
  } catch (e) {
    await client2.query('rollback')
    throw e
  } finally {
    client2.release()
  }
})
