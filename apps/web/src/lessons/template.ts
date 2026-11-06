// Parent messages from a template the tutor can rewrite (Settings → Parents).
// Placeholders are {names}. A line whose placeholders all come out empty is
// dropped, so deleting a line removes that part for good, and missing facts
// (no homework this week) never leave "Homework: ." behind. A first line
// "Subject: …" is the email subject. Pure, so it's tested without a browser.

export type TemplateKind = 'lesson' | 'report'

/** `label` is what the tutor sees; `block` details span several lines, so they come in with a section. */
export const PLACEHOLDERS: Record<TemplateKind, { name: string; label: string; hint: string; block?: boolean }[]> = {
  lesson: [
    { name: 'first_name', label: "Student's first name", hint: 'Sam (or "Ana and Ben" for siblings)' },
    { name: 'date', label: 'Lesson day', hint: 'the lesson day' },
    { name: 'covered', label: 'What you covered', hint: 'your lesson notes, else the plan title' },
    { name: 'board_score', label: 'Board answers', hint: '"3 of 4 answers right" on the board' },
    { name: 'last_homework', label: 'Last homework', hint: 'what came back since last time' },
    { name: 'homework', label: 'Homework set', hint: 'what was given, and when it is due' },
    { name: 'board_notes_link', label: 'Board notes link', hint: 'the board as a PDF' },
    { name: 'portal_link', label: 'Link to their page', hint: 'their homework and lessons page' },
    { name: 'tutor_name', label: 'Your name', hint: 'your name from Settings' },
  ],
  report: [
    { name: 'first_name', label: "Student's first name", hint: 'the student' },
    { name: 'period', label: 'Time period', hint: '"Oct 1 to Oct 31"' },
    { name: 'lesson_count', label: 'Number of lessons', hint: 'how many lessons' },
    { name: 'lessons', label: 'List of lessons', hint: 'one line per lesson: date and what it covered', block: true },
    { name: 'homework_summary', label: 'Homework summary', hint: '"4 of 5 handed in, 82% right"' },
    { name: 'homework_list', label: 'List of homework', hint: 'one line per piece of homework', block: true },
    { name: 'board_summary', label: 'Board answers', hint: '"12 of 15 answers right"' },
    { name: 'portal_link', label: 'Link to their page', hint: 'their homework and lessons page' },
    { name: 'tutor_name', label: 'Your name', hint: 'your name from Settings' },
  ],
}

/** The parts of a message a tutor can switch off and back on, in the order they usually read. */
export const SECTIONS: Record<TemplateKind, { key: string; label: string; text: string }[]> = {
  lesson: [
    { key: 'covered', label: 'What you covered', text: 'What we covered: {covered}' },
    { key: 'board', label: 'Board answers', text: 'On the board: {board_score}.' },
    { key: 'last_homework', label: 'Last homework', text: 'Last homework: {last_homework}.' },
    { key: 'homework', label: 'Homework set', text: 'Homework: {homework}.' },
    { key: 'notes', label: 'Board notes', text: 'Notes from the board: {board_notes_link}' },
    { key: 'portal', label: 'Link to their page', text: "{first_name}'s homework and lessons are here: {portal_link}" },
  ],
  report: [
    { key: 'lessons', label: 'Lessons', text: 'Lessons ({lesson_count}):\n{lessons}' },
    { key: 'homework', label: 'Homework', text: 'Homework: {homework_summary}.\n{homework_list}' },
    { key: 'board', label: 'Board answers', text: 'On the board: {board_summary}.' },
    { key: 'portal', label: 'Link to their page', text: "{first_name}'s homework and lessons are here: {portal_link}" },
  ],
}

export const DEFAULT_TEMPLATES: Record<TemplateKind, string> = {
  lesson: `Subject: {first_name}: lesson on {date}
Hi,

A quick update on {first_name}'s lesson on {date}.

What we covered: {covered}
On the board: {board_score}.
Last homework: {last_homework}.
Homework: {homework}.

Notes from the board: {board_notes_link}
{first_name}'s homework and lessons are here: {portal_link}

Best,
{tutor_name}`,
  report: `Subject: {first_name}: progress, {period}
Hi,

Here's how {first_name} has been getting on, {period}.

Lessons ({lesson_count}):
{lessons}

Homework: {homework_summary}.
{homework_list}

On the board: {board_summary}.

{first_name}'s homework and lessons are here: {portal_link}

Best,
{tutor_name}`,
}

/**
 * Who gets one message about a lesson: students who share a parent address are
 * one family, and everyone else is on their own. A group's parents never share
 * a message, which would hand each family the others' addresses and private
 * portal links.
 */
export function familiesOf<S extends { emails: { email: string; role: 'student' | 'parent' }[] }>(students: S[]): S[][] {
  const out: { parents: Set<string>; students: S[] }[] = []
  for (const s of students) {
    const parents = s.emails.filter((e) => e.role === 'parent').map((e) => e.email.toLowerCase())
    const family = out.find((f) => parents.some((p) => f.parents.has(p)))
    if (family) {
      family.students.push(s)
      parents.forEach((p) => family.parents.add(p))
    } else {
      out.push({ parents: new Set(parents), students: [s] })
    }
  }
  return out.map((f) => f.students)
}

interface ResultsForFamily {
  board: { right: string[]; wrong: { name: string }[] }[]
  homework: { title: string; handedInBy: string[]; misses: { who: { name: string }[] }[] }[]
}

/** How these students did, and only these: the facts a family's update reports. */
export function familyResults(names: string[], results: ResultsForFamily | null): { boardScore: string; lastHomework: string } {
  const ours = (name: string) => names.includes(name)
  const right = results?.board.reduce((n, q) => n + q.right.filter(ours).length, 0) ?? 0
  const wrong = results?.board.reduce((n, q) => n + q.wrong.filter((w) => ours(w.name)).length, 0) ?? 0
  const hw = results?.homework.find((h) => h.handedInBy.some(ours))
  const missed = hw?.misses.filter((m) => m.who.some((w) => ours(w.name))).length ?? 0
  return {
    boardScore: right + wrong ? `${right} of ${right + wrong} answers right` : '',
    lastHomework: hw ? `${hw.title}, ${missed ? `${missed} to go over` : 'all right'}` : '',
  }
}

const PLACEHOLDER = /\{([a-z_]+)\}/g

/** A template as the editor shows it: the email subject apart from the message. */
export function splitTemplate(template: string): { subject: string; body: string } {
  const lines = template.replace(/\r/g, '').split('\n')
  if (!/^subject:/i.test(lines[0] ?? '')) return { subject: '', body: lines.join('\n') }
  return { subject: lines[0].replace(/^subject:\s*/i, ''), body: lines.slice(1).join('\n') }
}

export function joinTemplate({ subject, body }: { subject: string; body: string }): string {
  return subject.trim() ? `Subject: ${subject.trim()}\n${body}` : body
}

/** Text and the details inside it. Anything that isn't one of `kind`'s details stays text. */
export function templateParts(text: string, kind: TemplateKind): ({ text: string } | { name: string; label: string })[] {
  const parts: ({ text: string } | { name: string; label: string })[] = []
  let at = 0
  for (const m of text.matchAll(PLACEHOLDER)) {
    const detail = PLACEHOLDERS[kind].find((p) => p.name === m[1])
    if (!detail) continue
    if (m.index > at) parts.push({ text: text.slice(at, m.index) })
    parts.push({ name: detail.name, label: detail.label })
    at = m.index + m[0].length
  }
  if (at < text.length) parts.push({ text: text.slice(at) })
  return parts
}

// A section is "in" while any of its own details is; the student's name is in everything.
const sectionNames = (text: string) => [...text.matchAll(PLACEHOLDER)].map((m) => m[1]).filter((n) => n !== 'first_name')
const onLine = (line: string, names: string[]) => names.some((n) => line.includes(`{${n}}`))

export function hasSection(body: string, kind: TemplateKind, key: string): boolean {
  const names = sectionNames(SECTIONS[kind].find((s) => s.key === key)!.text)
  return body.split('\n').some((l) => onLine(l, names))
}

/**
 * Takes a section out line by line, or puts it back: before the next section
 * that's still there, else above the sign-off (the last paragraph).
 */
export function toggleSection(body: string, kind: TemplateKind, key: string): string {
  const all = SECTIONS[kind]
  const i = all.findIndex((s) => s.key === key)
  const names = sectionNames(all[i].text)
  const lines = body.split('\n')
  const tidy = (l: string[]) => l.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  if (hasSection(body, kind, key)) return tidy(lines.filter((l) => !onLine(l, names)))

  const added = all[i].text.split('\n')
  const next = all.slice(i + 1).map((s) => lines.findIndex((l) => onLine(l, sectionNames(s.text)))).find((n) => n >= 0)
  const at = next ?? (lines.lastIndexOf('') + 1 || lines.length)
  if (at === lines.length) added.unshift('')
  else if (at === 0 || lines[at - 1] === '') added.push('')
  lines.splice(at, 0, ...added)
  return tidy(lines)
}

/** Fills a template. Unknown placeholders stay as typed, so a typo shows up in the preview. */
export function fillTemplate(template: string, vars: Record<string, string | null | undefined>): { subject: string; body: string } {
  const lines = template.replace(/\r/g, '').split('\n')
  let subject = ''
  if (/^subject:/i.test(lines[0] ?? '')) subject = lines.shift()!.replace(/^subject:\s*/i, '')
  const value = (name: string) => (Object.prototype.hasOwnProperty.call(vars, name) ? (vars[name] ?? '').trim() : null)
  const fill = (line: string) => line.replace(PLACEHOLDER, (m, name: string) => value(name) ?? m)

  const kept: string[] = []
  for (const line of lines) {
    const names = [...line.matchAll(PLACEHOLDER)].map((m) => m[1])
    if (names.length && names.every((n) => value(n) === '')) continue
    kept.push(fill(line))
  }
  // Dropped lines can leave blank lines doubled up; keep at most one.
  const body = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return { subject: fill(subject).trim(), body }
}
