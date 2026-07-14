import { Router } from 'express'
import { studentQuery } from '../db.ts'

export const portalRouter = Router()

// The student's home: their name + every assignment with attempt status and,
// once submitted, their score. The attempt_token deep-links into the runner.
portalRouter.get('/:token', async (req, res) => {
  const [student] = await studentQuery<{ id: string; name: string }>(
    req.params.token,
    `select id, name from students where portal_token = $1 and archived_at is null`,
  )
  if (!student) return res.status(404).json({ error: 'not found' })

  const assignments = await studentQuery(
    req.params.token,
    `select asg.id as assignment_id,
            asg.title,
            asg.time_limit_sec,
            asg.due_at,
            asg.created_at,
            ps.title as set_title,
            att.attempt_token,
            coalesce(att.status, 'pending') as status,
            (select count(*) from set_problems sp where sp.set_id = asg.set_id) as total,
            (select count(*) from responses r
               where r.attempt_id = att.id and r.is_correct) as score
       from students st
       join assignment_student ascd on ascd.student_id = st.id
       join assignments asg on asg.id = ascd.assignment_id
       join problem_sets ps on ps.id = asg.set_id
       left join attempts att on att.assignment_id = asg.id and att.student_id = st.id
      where st.portal_token = $1
      order by asg.created_at desc`,
  )

  res.json({ studentName: student.name, assignments })
})
