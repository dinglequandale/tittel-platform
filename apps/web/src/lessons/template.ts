// Parent messages from a template the tutor can rewrite (Settings → Parents).
// Placeholders are {names}. A line whose placeholders all come out empty is
// dropped, so deleting a line removes that part for good, and missing facts
// (no homework this week) never leave "Homework: ." behind. A first line
// "Subject: …" is the email subject. Pure, so it's tested without a browser.

export type TemplateKind = 'lesson' | 'report'

export const PLACEHOLDERS: Record<TemplateKind, { name: string; hint: string }[]> = {
  lesson: [
    { name: 'first_name', hint: 'Sam (or "Ana and Ben" for a group)' },
    { name: 'date', hint: 'the lesson day' },
    { name: 'covered', hint: 'your lesson notes, else the plan title' },
    { name: 'board_score', hint: '"3 of 4 answers right" on the board' },
    { name: 'last_homework', hint: 'what came back since last time' },
    { name: 'homework', hint: 'what was given, and when it is due' },
    { name: 'board_notes_link', hint: 'the board as a PDF' },
    { name: 'portal_link', hint: 'their homework and lessons page' },
    { name: 'tutor_name', hint: 'your name from Settings' },
  ],
  report: [
    { name: 'first_name', hint: 'the student' },
    { name: 'period', hint: '"Oct 1 to Oct 31"' },
    { name: 'lesson_count', hint: 'how many lessons' },
    { name: 'lessons', hint: 'one line per lesson: date and what it covered' },
    { name: 'homework_summary', hint: '"4 of 5 handed in, 82% right"' },
    { name: 'homework_list', hint: 'one line per piece of homework' },
    { name: 'board_summary', hint: '"12 of 15 answers right"' },
    { name: 'portal_link', hint: 'their homework and lessons page' },
    { name: 'tutor_name', hint: 'your name from Settings' },
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

const PLACEHOLDER = /\{([a-z_]+)\}/g

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
