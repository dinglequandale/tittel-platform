// Parsers that read what tutors paste and what calendar invites say:
// invitee names (lessons/invitees.ts) and text to homework or a plan
// (lessons/composer.ts). Pure functions, so no browser needed.
import { proposePeople, nameFromTitle } from '../src/lessons/invitees.ts'
import { draftFromText, planFromText } from '../src/lessons/composer.ts'
import { parseLessonDoc } from '@tittel/shared'
let bad = 0
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`}`)
}
const eq2 = (name: string, cond: boolean, extra?: unknown) => { if (!cond) bad++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + JSON.stringify(extra)}`) }
const names = (t: string, a: string[]) => { const p = proposePeople(t, a); return { people: p.people.map((x) => x.name || `?${x.surname ?? ''}`), parents: p.parents } }
eq('Leo + mom', names('Leo - Algebra', ['leo.park09@gmail.com', 'grace.park@gmail.com']), { people: ['Leo Park'], parents: ['grace.park@gmail.com'] })
eq('Ava (w/)', names('SAT prep w/ Ava', ['ava.nguyen@gmail.com']), { people: ['Ava Nguyen'], parents: [] })
eq('Isabel', names('Calc - Isabel', ['isabel.ruiz@stjohns.edu']), { people: ['Isabel Ruiz'], parents: [] })
eq('SAT group of 3', names('SAT Math Group', ['jonah.lee22@gmail.com', 'priya.shah.07@gmail.com', 'ben.cohen.sat@gmail.com']),
  { people: ['Jonah Lee', 'Priya Shah', 'Ben Cohen'], parents: [] })
eq('Haddad kids via dad', names('Haddad kids - math', ['khaled.haddad@outlook.com']), { people: ['?Haddad', '?Haddad'], parents: ['khaled.haddad@outlook.com'] })
eq("Okafor's son", names("Trial lesson? (Mrs. Okafor's son)", ['n.okafor@yahoo.com']), { people: ['?Okafor'], parents: ['n.okafor@yahoo.com'] })
eq('no invitees', names('Calc - Isabel', []), { people: ['Isabel'], parents: [] })
eq('title name', nameFromTitle('SAT prep w/ Ava'), 'Ava')
eq('title name 2', nameFromTitle('Math - Seb'), 'Seb')
eq('title no name', nameFromTitle('SAT Math Group'), '')

// ChatGPT-style homework with an answer key at the end.
const gpt = `Here are 5 practice problems on factoring quadratics:

1. Factor \\(x^2 + 5x + 6\\).
2. Which is the factored form of $x^2 - 4x + 4$?
A) $(x-2)^2$
B) $(x+2)^2$
C) $(x-4)(x+1)$
D) $(x-1)(x-4)$
3. Solve $x^2 - 7x + 12 = 0$. Give the larger root.
4. Solve $x^2 + x - 12 = 0$. Give the positive root.
5. Explain why $x^2 + 1$ cannot be factored over the reals.

**Answer Key:**
1. (x+2)(x+3)
2. A
3. 4
4. 3`
const d = draftFromText(gpt, 'Quadratics HW')
eq2('five problems', d.problems.length === 5, d.problems.map((p) => p.stemLatex))
eq2('intro line not a problem; math converted', d.problems[0].stemLatex === 'Factor $x^2 + 5x + 6$.', d.problems[0].stemLatex)
eq2('1: text answer from key', d.problems[0].type === 'text' && d.problems[0].correct === '(x+2)(x+3)', d.problems[0])
eq2('2: multiple choice with 4 choices, A', d.problems[1].type === 'mc' && d.problems[1].choices?.length === 4 && d.problems[1].correct === 'A', d.problems[1])
eq2('3: numeric 4', d.problems[2].type === 'numeric' && d.problems[2].correct === '4', d.problems[2])
eq2('5: no answer -> free response', d.problems[4].type === 'frq' && d.problems[4].answerConfidence === 'missing', d.problems[4])

// Inline answers, unnumbered blocks, inline choices.
const typed = `What is 3 + 4?
Answer: 7

Pick the prime: (A) 4 (B) 9 (C) 7 (D) 15
Answer: C

Solve for x: 2x = 10
Ans: x = 5`
const t = draftFromText(typed, '')
eq2('three unnumbered problems', t.problems.length === 3, t.problems)
eq2('inline answer numeric', t.problems[0].type === 'numeric' && t.problems[0].correct === '7', t.problems[0])
eq2('inline choices', t.problems[1].type === 'mc' && t.problems[1].choices?.map((c) => c.content).join('|') === '4|9|7|15' && t.problems[1].correct === 'C', t.problems[1])
eq2('"x = 5" answer -> numeric 5', t.problems[2].type === 'numeric' && t.problems[2].correct === '5', t.problems[2])

// A plan from text, through the server's own parser.
const plan = planFromText(`# Factoring quadratics
Look for two numbers that multiply to $c$ and add to $b$.

1. Factor $x^2+5x+6$.
Answer: (x+2)(x+3)
---
# Practice
Which is $x^2-9$ factored? A) (x-3)(x+3) B) (x-9)(x+1)
Answer: A`, 'Quadratics')
const parsed = parseLessonDoc(JSON.parse(JSON.stringify(plan)))
eq2('two pages', parsed.pages.length === 2, parsed)
eq2('heading block', parsed.pages[0].blocks[0].kind === 'heading' && parsed.pages[0].blocks[0].content === 'Factoring quadratics', parsed.pages[0].blocks[0])
eq2('answer box: typed', parsed.pages[0].blocks[2].answer?.format === 'grid' && parsed.pages[0].blocks[2].answer?.key === '(x+2)(x+3)', parsed.pages[0].blocks[2])
eq2('answer box: choice', parsed.pages[1].blocks[1].answer?.format === 'choice' && parsed.pages[1].blocks[1].answer?.key === 'A', parsed.pages[1].blocks[1])

console.log(bad ? `\n${bad} failed` : '\nAll parser checks passed.')
process.exit(bad ? 1 : 0)
