// Parsers that read what tutors paste and what calendar invites say:
// invitee names (lessons/invitees.ts) and text to homework or a plan
// (lessons/composer.ts). Pure functions, so no browser needed.
import { proposePeople, nameFromTitle } from '../src/lessons/invitees.ts'
import { draftFromText, planFromText, planFromImages, boxesOf, withBoxes } from '../src/lessons/composer.ts'
import { fillTemplate, familiesOf, familyResults, splitTemplate, joinTemplate, templateParts, hasSection, toggleSection, DEFAULT_TEMPLATES } from '../src/lessons/template.ts'
import { furthest, resumeStep, stepAfter, stepsFor, stepToShow } from '../src/onboarding/steps.ts'
import { computeLayout } from '../src/board/lesson/layout.ts'
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

// The key on the heading's own line, after a blank line (from the persona trial).
const oneLine = draftFromText(`1) Solve for x: 3x - 7 = 11
2) Simplify √50
3) If f(x) = 2x² − 3, find f(−2).
4) The graph of y = x² is shifted 3 units right. Which equation?
(a) y = (x+3)²
(b) y = (x−3)²
(c) y = x² + 3
5) Explain why a quadratic can have at most two real roots.

Answers: 1) 6  2) 5√2  3) 5  4) b`, '')
eq2('one-line key: five problems', oneLine.problems.length === 5, oneLine.problems.map((p) => p.stemLatex))
eq2('one-line key: four answers found', oneLine.problems.filter((p) => p.answerConfidence === 'found').length === 4, oneLine.problems)
eq2('one-line key: key not in the last stem', !oneLine.problems[4].stemLatex.includes('Answers'), oneLine.problems[4].stemLatex)
eq2('one-line key: 4 is multiple choice B', oneLine.problems[3].type === 'mc' && oneLine.problems[3].correct === 'B', oneLine.problems[3])
eq2('one-line key: 1 numeric 6', oneLine.problems[0].type === 'numeric' && oneLine.problems[0].correct === '6', oneLine.problems[0])
eq2('one-line key: 2 text 5√2', oneLine.problems[1].type === 'text' && oneLine.problems[1].correct === '5√2', oneLine.problems[1])
const singular = draftFromText('What is 7 ÷ 2?\nAnswer: 3.5', '')
eq2('"Answer: 3.5" stays an inline answer', singular.problems.length === 1 && singular.problems[0].correct === '3.5', singular.problems)

// Parent messages from the tutor's template.
const filled = fillTemplate(DEFAULT_TEMPLATES.lesson, {
  first_name: 'Sam', date: 'Thu, Oct 29', covered: 'Factoring went well; next time, completing the square.', board_score: '1 question to practise',
  last_homework: '', homework: '', board_notes_link: '', portal_link: 'https://x/s/abc', tutor_name: 'Konrad',
})
eq('template: subject from the first line', filled.subject, 'Sam: lesson on Thu, Oct 29')
eq2('template: empty parts dropped', !filled.body.includes('Homework') && !filled.body.includes('Notes from the board'), filled.body)
eq2('template: the tutor\'s note comes first', filled.body.startsWith('Hi,\n\nFactoring went well; next time, completing the square.\n'), filled.body)
eq2('template: counts read as what to practise', filled.body.includes('From the board: 1 question to practise.') && !/of \d+ answers right/.test(filled.body), filled.body)
eq2('template: no doubled blank lines', !/\n\n\n/.test(filled.body), filled.body)
eq2('template: signed with the name', filled.body.endsWith('Best,\nKonrad'), filled.body)
eq('template: unknown placeholder kept, no subject', fillTemplate('Hi {nmae}', { first_name: 'Sam' }), { subject: '', body: 'Hi {nmae}' })
eq('template: plain lines always kept', fillTemplate('Thanks!\n{covered}', { covered: '' }).body, 'Thanks!')

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

// A group's parent updates: one per family, each with only its own child.
const kid = (name: string, ...parents: string[]) => ({ name, emails: parents.map((email) => ({ email, role: 'parent' as const })) })
const fam = (students: ReturnType<typeof kid>[]) => familiesOf(students).map((f) => f.map((s) => s.name))
eq('families: separate parents stay apart', fam([kid('Ana', 'a@x.com'), kid('Ben', 'b@x.com')]), [['Ana'], ['Ben']])
eq('families: siblings share a message', fam([kid('Ana', 'a@x.com'), kid('Ben', 'A@x.com', 'b@x.com'), kid('Cy', 'b@x.com')]), [['Ana', 'Ben', 'Cy']])
eq('families: no parent address means alone', fam([kid('Ana'), kid('Ben')]), [['Ana'], ['Ben']])
const groupResults = {
  board: [{ right: ['Ana Reyes'], wrong: [{ name: 'Ben Cole' }] }, { right: [], wrong: [{ name: 'Ana Reyes' }, { name: 'Ben Cole' }] }],
  homework: [{ title: 'Quadratics', handedInBy: ['Ana Reyes'], misses: [{ who: [{ name: 'Ana Reyes' }] }, { who: [{ name: 'Ben Cole' }] }] }],
}
eq('family results: only their child counts', familyResults(['Ana Reyes'], groupResults), { boardScore: '1 question to practise', lastHomework: 'Quadratics, 1 to go over' })
eq('family results: nothing handed in', familyResults(['Ben Cole'], groupResults), { boardScore: '2 questions to practise', lastHomework: '' })
eq('family results: all right', familyResults(['Ana Reyes'], { board: [{ right: ['Ana Reyes'], wrong: [] }, { right: ['Ana Reyes'], wrong: [] }], homework: [] }), { boardScore: 'all 2 answered right', lastHomework: '' })

// Answer boxes pinned on PDF pages.
const pdf = planFromImages(['/api/files/a', '/api/files/b'], 'Worksheet')
const pinned = withBoxes(pdf, [
  { page: 1, x: 0.5, y: 0.2, choices: 'ABCDE', key: 'E' },
  { page: 0, x: 0.3, y: 0.8, choices: 'typed', key: ' 12 ' },
  { page: 0, x: 0.3, y: 0.1, choices: 'ABCD', key: 'B' },
])
eq('pinned boxes number down the pages', pinned.pages.flatMap((p) => p.blocks.filter((b) => b.at).map((b) => `${b.content}=${b.answer?.key}`)), ['Q1=B', 'Q2=12', 'Q3=E'])
const reparsed = parseLessonDoc(JSON.parse(JSON.stringify(pinned)))
eq2('pins survive a save', reparsed.pages[0].blocks[1].at?.y === 0.1 && reparsed.pages[1].blocks[1].answer?.choices?.length === 5, reparsed.pages[1].blocks[1])
eq('pins read back for editing', boxesOf(reparsed).map((b) => `${b.page}:${b.choices}:${b.key}`), ['0:ABCD:B', '0:typed:12', '1:ABCDE:E'])
eq('boxes can all be removed', withBoxes(reparsed, []).pages.map((p) => p.blocks.length), [1, 1])
const placed = computeLayout(reparsed, 'p', (_, bi) => (bi === 0 ? { w: 900, h: 1200 } : { w: 40, h: 28 }))
eq('a pin sits on the page, centred on the click', { x: placed[0].blocks[1].x, y: placed[0].blocks[1].y }, { x: 250, y: 186 })
eq2('a pin takes no room in the flow', placed[1].blocks[0].y === 80, placed[1].blocks[0])
const bad_at = parseLessonDoc({ pages: [{ blocks: [{ type: 'text', content: 'x', at: { x: 2, y: 0 } }] }] })
eq2('a pin off the page is dropped', bad_at.pages[0].blocks[0].at === undefined, bad_at.pages[0].blocks[0])

// The wording editor: words and pills in, the same template out.
for (const kind of ['lesson', 'report'] as const) {
  eq(`${kind} template survives the editor`, joinTemplate(splitTemplate(DEFAULT_TEMPLATES[kind])), DEFAULT_TEMPLATES[kind])
}
eq('no subject line stays that way', splitTemplate('Hi {first_name}'), { subject: '', body: 'Hi {first_name}' })
eq('details become parts', templateParts("{first_name}'s {oops} {period}", 'report'), [
  { name: 'first_name', label: "Student's first name" }, { text: "'s {oops} " }, { name: 'period', label: 'Time period' },
])
const reportBody = splitTemplate(DEFAULT_TEMPLATES.report).body
const noBoard = toggleSection(reportBody, 'report', 'board')
eq2('a section comes out', !hasSection(noBoard, 'report', 'board') && !noBoard.includes('On the board'), noBoard)
eq2('its neighbours stay', hasSection(noBoard, 'report', 'homework') && hasSection(noBoard, 'report', 'portal'), noBoard)
eq('and goes back where it was', toggleSection(noBoard, 'report', 'board'), reportBody)
const noLessons = toggleSection(reportBody, 'report', 'lessons')
eq('a first section goes back first', toggleSection(noLessons, 'report', 'lessons'), reportBody)
const noPortal = toggleSection(reportBody, 'report', 'portal')
eq('a last section goes back above the sign-off', toggleSection(noPortal, 'report', 'portal'), reportBody)
eq('a one-paragraph message gets it at the end', toggleSection('Hi', 'report', 'board'), 'Hi\n\nOn the board: {board_summary}.')
const lessonBody = splitTemplate(DEFAULT_TEMPLATES.lesson).body
eq('a line inside a paragraph goes back there', toggleSection(toggleSection(lessonBody, 'lesson', 'last_homework'), 'lesson', 'last_homework'), lessonBody)

// Setup: which steps a tutor gets, and where they pick up.
const noReports = { reports: true, reminder: 'none' }
const monthly = { reports: true, reminder: 'monthly' }
eq2('the report step is only for regular reports', !stepsFor(noReports).includes('report') && stepsFor(monthly).includes('report'))
eq('parents leads to the report', stepAfter('parents', monthly), 'report')
eq('or straight to the end', stepAfter('parents', noReports), 'ready')
eq('going back keeps your place', furthest('parents', 'teaching'), 'parents')
eq('a new tutor starts at the start', resumeStep({ onboardingStep: null, consentAt: null, parentUpdates: noReports }), 'you')
eq('consent given on the old screen is not asked again', resumeStep({ onboardingStep: null, consentAt: 'x', parentUpdates: noReports }), 'teaching')
eq('a saved step comes back', resumeStep({ onboardingStep: 'calendar', consentAt: 'x', parentUpdates: noReports }), 'calendar')
eq('no way past consent', resumeStep({ onboardingStep: 'ready', consentAt: null, parentUpdates: noReports }), 'consent')
eq('a report step no longer wanted', resumeStep({ onboardingStep: 'report', consentAt: 'x', parentUpdates: noReports }), 'ready')
eq('the address can go back', stepToShow('you', 'calendar', noReports), 'you')
eq('but not ahead', stepToShow('ready', 'calendar', noReports), 'calendar')
eq('nor anywhere made up', stepToShow('nope', 'calendar', noReports), 'calendar')

console.log(bad ? `\n${bad} failed` : '\nAll parser checks passed.')
process.exit(bad ? 1 : 0)
