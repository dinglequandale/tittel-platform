import { newId } from '@tittel/shared'
import { boardQuery } from '../db.ts'

// What happened in a lesson, kept after the board closes (OVERHAUL O3): each
// answer to a plan's answer box. Questions on a lesson's plan have ids
// `lesson-<sessionId>-<page>-<block>` (board/lesson/layout.ts), which tie an
// answer to its lesson and its problem. Library plans loaded by hand
// (`plan-…`) aren't tied to a lesson and aren't kept.
const LESSON_QID = /^lesson-(.+)-(\d+)-(\d+)$/

export function lessonOfQuestion(qid: string): { sessionId: string; page: number; block: number } | null {
  const m = qid.match(LESSON_QID)
  return m ? { sessionId: m[1], page: Number(m[2]), block: Number(m[3]) } : null
}

/**
 * Keeps one answer. The student is the board's own student on a 1:1 board;
 * on a group board, the member whose first name matches the name they joined
 * with, else just that name. The lesson must be in the board's org.
 */
export async function recordBoardAnswer(
  boardId: string,
  a: { qid: string; name: string; answer: string; correct: boolean; elapsedMs: number },
): Promise<void> {
  const lesson = lessonOfQuestion(a.qid)
  if (!lesson) return
  await boardQuery(
    boardId,
    `insert into quiz_events (id, org_id, session_id, student_id, guest_name, qid, answer, is_correct, elapsed_ms)
     select $2, b.org_id, se.id,
            coalesce(b.student_id, (
              select s.id from group_members gm join students s on s.id = gm.student_id
               where gm.group_id = se.group_id and s.archived_at is null
                 and lower(split_part(s.name, ' ', 1)) = lower(split_part(trim($4), ' ', 1))
               limit 1)),
            nullif(trim($4), ''), $5, $6::jsonb, $7, $8
       from boards b join sessions se on se.id = $3 and se.org_id = b.org_id
      where b.id = $1 /* board_id */`,
    [newId(), lesson.sessionId, a.name, a.qid, JSON.stringify(a.answer), a.correct, Math.round(a.elapsedMs)],
  )
}
