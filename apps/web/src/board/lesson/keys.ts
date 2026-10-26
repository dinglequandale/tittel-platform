import type { LessonBlock, LessonDoc, QuestionKey, QuestionMeta } from '@tittel/shared'
import { blockId } from './layout.ts'

// The key/meta split, enforced in code (ported from the legacy whiteboard): a
// block's `answer` carries the answer key, which must NEVER reach a synced
// tldraw shape — `meta` is synced to every student and readable in devtools.
//   - `questionMetaFor`     -> shape `meta.q`, synced. Identity + format only.
//   - `questionKeysFromDoc` -> host-side only, sent to the server over the
//     control channel by the caller.

export function questionMetaFor(block: LessonBlock, prefix: string, pi: number, bi: number): QuestionMeta | undefined {
  if (!block.answer) return undefined
  const { format, choices } = block.answer
  return { id: blockId(prefix, pi, bi), format, choices: format === 'choice' ? choices : undefined }
}

export function questionKeysFromDoc(doc: LessonDoc, prefix: string): QuestionKey[] {
  const keys: QuestionKey[] = []
  doc.pages.forEach((page, pi) => {
    page.blocks.forEach((block, bi) => {
      const { answer } = block
      if (!answer) return
      keys.push({
        id: blockId(prefix, pi, bi),
        format: answer.format,
        key: answer.key,
        accept: answer.accept,
        choices: answer.choices,
        reveal: answer.reveal,
      })
    })
  })
  return keys
}
